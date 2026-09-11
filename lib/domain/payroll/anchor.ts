/**
 * 主播工资计算器（阶段5 核心，纯函数、可信端执行）。
 * 落地「保底/提成互斥模式」规则：
 *  - 门槛：thresholdInCents = ceil(初始保底 × thresholdMultiplierBps / 10000)（固定用初始保底）。
 *  - 达标：按当月流水，monthlyRevenue >= 门槛（无责期与非无责期一致）。
 *  - 基础收益（保底工资）：当月达标 → 初始保底；不达标 → 降级保底。
 *  - 拿提点门槛（提成起征）= 初始保底 × 5（固定用初始保底），无责期同样适用。
 *  - 提成互斥：流水 >= 拿提点门槛 → 总工资 = 总流水 × 最终提成率（不叠加保底工资）；否则总工资 = 保底工资全额（无提成）。
 *  - 阶梯提成：20% 起步，超过拿提点门槛每满 1万 提点 +1%，最高 +5 个百分点；最终提成率不封顶。
 *  - 服务费 = ceil(总工资 × serviceFeeRateBps / 10000)
 *  - 实发 = 总工资 − 服务费，允许为负。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { applyRateCeil, applyRateFloor, isWithinGracePeriod } from "./money";
import { parseAdjustmentAmountYuan } from "./adjustment";
import {
  COMMISSION_STEP_IN_CENTS,
  COMMISSION_STEP_RATE_BPS,
  COMMISSION_MAX_STEPS,
  COMMISSION_BASE_RATE_BPS,
  DEFAULT_SERVICE_FEE_RATE_BPS,
  GRACE_PERIOD_MONTHS,
  type AnchorPayrollInput,
  type AnchorPayrollResult,
} from "./types";

// PostgreSQL integer 的存储上限，仅为技术限制，不是业务费率封顶。
const POSTGRES_INT_MAX = 2_147_483_647;

/** 字符串百分点转基点；空值默认 0，至多两位小数，非法输入返回 null。 */
export function parseCommissionBonusPoints(value: string): number | null {
  if (!value.trim()) return 0;
  const bps = parseAdjustmentAmountYuan(value);
  return bps !== null && bps <= POSTGRES_INT_MAX ? bps : null;
}

function validateInput(input: AnchorPayrollInput): void {
  const {
    scheme,
    monthlyRevenueInCents,
    tenureMonth,
    attendanceBonusBps = 0,
    dyTaskBonusBps = 0,
    baseCommissionRateBps = COMMISSION_BASE_RATE_BPS,
  } = input;
  if ([attendanceBonusBps, dyTaskBonusBps].some(
    (bps) => !Number.isInteger(bps) || bps < 0 || bps > POSTGRES_INT_MAX,
  )) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "提成加点须为有效非负整数基点");
  }
  if (!Number.isInteger(baseCommissionRateBps) || baseCommissionRateBps <= 0 || baseCommissionRateBps > 10000) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础提成率范围为 0.01%～100%");
  }
  if (!scheme) {
    throw new ApiError(ApiErrorCode.SALARY_SCHEME_MISSING, "缺少主播工资方案");
  }
  const invalid =
    !Number.isInteger(scheme.baseSalaryInCents) ||
    !Number.isInteger(scheme.guaranteedSalaryInCents) ||
    !Number.isInteger(scheme.thresholdMultiplierBps) ||
    !Number.isInteger(monthlyRevenueInCents) ||
    !Number.isInteger(tenureMonth) ||
    tenureMonth < 1;
  if (invalid) {
    throw new ApiError(
      ApiErrorCode.INVALID_INPUT,
      "工资输入非法：金额/比例须为整数分或基点，月序须 >= 1",
    );
  }
}

/**
 * 计算阶梯提成费率（基点）——全额累进。
 * 阶梯加点 = min(max(floor((流水 - 拿提点门槛) / 1万元), 0), 5) × 1%。
 * 基础与阶梯费率 = 20% + 阶梯加点；另外叠加考勤及 dy 任务加点，总费率无业务封顶。
 */
function resolveCommissionRateBps(
  monthlyRevenueInCents: number,
  commissionStartInCents: number,
  baseCommissionRateBps: number,
): number {
  const steps = Math.max(
    0,
    Math.floor((monthlyRevenueInCents - commissionStartInCents) / COMMISSION_STEP_IN_CENTS),
  );
  const cappedSteps = Math.min(steps, COMMISSION_MAX_STEPS);
  const stepRateBps = cappedSteps * COMMISSION_STEP_RATE_BPS;
  return baseCommissionRateBps + stepRateBps;
}

/**
 * 计算某主播某月工资明细。纯函数，无副作用，不做负数归零。
 */
export function calculateAnchorPayroll(
  input: AnchorPayrollInput,
): AnchorPayrollResult {
  validateInput(input);

  const {
    scheme,
    monthlyRevenueInCents,
    tenureMonth,
    attendanceBonusBps = 0,
    dyTaskBonusBps = 0,
    baseCommissionRateBps = COMMISSION_BASE_RATE_BPS,
  } = input;
  const serviceFeeRateBps = input.serviceFeeRateBps ?? DEFAULT_SERVICE_FEE_RATE_BPS;
  const isGracefulPeriod = isWithinGracePeriod(tenureMonth, GRACE_PERIOD_MONTHS);

  // 达标门槛固定用「初始保底 × 系数」计算（向上取整到分），不随保底基准变动。
  const thresholdInCents = applyRateCeil(
    scheme.baseSalaryInCents,
    scheme.thresholdMultiplierBps,
  );
  // 达标判定统一按「当月流水」：>= 门槛即达标（无责期与非无责期一致）。
  const isQualified = monthlyRevenueInCents >= thresholdInCents;

  // 保底基准（基础收益）：当月达标 → 初始保底；不达标 → 降级保底。
  const baseGuaranteeInCents = isQualified
    ? scheme.baseSalaryInCents
    : scheme.guaranteedSalaryInCents;

  // 拿提点门槛（提成起征）= 初始保底 × 5（固定用初始保底），无责期同样适用。
  const commissionStartInCents = scheme.baseSalaryInCents * 5;

  // 阶梯提成：仅当流水 >= 拿提点门槛才计提，全额累进。
  const commissionRateBps =
    monthlyRevenueInCents >= commissionStartInCents
      ? resolveCommissionRateBps(
          monthlyRevenueInCents,
          commissionStartInCents,
          baseCommissionRateBps,
        ) + attendanceBonusBps + dyTaskBonusBps
      : 0;
  if(!Number.isInteger(commissionRateBps) || commissionRateBps > POSTGRES_INT_MAX) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "最终提成费率超过 PostgreSQL int 存储范围");
  }

  // 提成互斥规则：
  //  - 流水 >= 拿提点门槛 → 走提成模式，总工资 = 总流水 × 最终提成率（不叠加保底工资）。
  //  - 否则 → 走保底模式，总工资 = 保底工资全额（无提成）。
  const isCommissionMode = commissionRateBps > 0;
  const performanceComponentInCents = isCommissionMode
    ? applyRateFloor(monthlyRevenueInCents, commissionRateBps)
    : 0;
  const guaranteedComponentInCents = isCommissionMode ? 0 : baseGuaranteeInCents;

  const grossSalaryInCents =
    guaranteedComponentInCents + performanceComponentInCents;
  const serviceFeeInCents = applyRateCeil(grossSalaryInCents, serviceFeeRateBps);
  const netSalaryInCents = grossSalaryInCents - serviceFeeInCents;

  return {
    baseGuaranteeInCents,
    thresholdInCents,
    commissionStartInCents,
    commissionRateBps,
    baseCommissionRateBps,
    isQualified,
    isGracefulPeriod,
    guaranteedComponentInCents,
    performanceComponentInCents,
    grossSalaryInCents,
    serviceFeeInCents,
    netSalaryInCents,
  };
}