/**
 * 主播工资计算器（阶段5 核心，纯函数、可信端执行）。
 * 落地「保底优先模式」规则：
 *  - 保底基准：无责期(前3月)或上月达标 → 初始保底；第4月起上月不达标 → 降级保底。
 *  - 门槛：thresholdInCents = ceil(保底基准 × thresholdMultiplierBps / 10000)
 *  - 达标：monthlyRevenue >= 门槛
 *  - 保底工资：无论达标与否均发放保底工资全额。
 *  - 阶梯提成：流水 >= 提成起征(保底÷0.2)才计提；固定阶梯 20% 起步，
 *    超过拿提点门槛的流水每满 1万 提点 +1%，最高 +5 个百分点；最终提成率不封顶（全额累进）。
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

  // 保底基准：无责期或有上月达标 → 初始保底；否则降级保底。
  const lastMonthQualified = input.lastMonthQualified ?? true;
  const baseGuaranteeInCents =
    isGracefulPeriod || lastMonthQualified
      ? scheme.baseSalaryInCents
      : scheme.guaranteedSalaryInCents;

  // 达标门槛：保底基准 × 系数（向上取整到分）。
  const thresholdInCents = applyRateCeil(
    baseGuaranteeInCents,
    scheme.thresholdMultiplierBps,
  );
  const isQualified = monthlyRevenueInCents >= thresholdInCents;

  // 提成起征流水 = 保底基准 ÷ 0.2（= 保底 × 5），向上取整到分。
  const commissionStartInCents = baseGuaranteeInCents * 5;

  // 保障性部分：保底工资全额（无论达标与否）。
  const guaranteedComponentInCents = baseGuaranteeInCents;

  // 阶梯提成：仅当流水 >= 提成起征才计提，全额累进。
  const commissionRateBps =
    monthlyRevenueInCents >= commissionStartInCents
      ? resolveCommissionRateBps(
          monthlyRevenueInCents,
          commissionStartInCents,
          baseCommissionRateBps,
        ) + attendanceBonusBps + dyTaskBonusBps
      : 0;
  if (!Number.isInteger(commissionRateBps) || commissionRateBps > POSTGRES_INT_MAX) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "最终提成费率超过 PostgreSQL int 存储范围");
  }
  const performanceComponentInCents =
    commissionRateBps > 0
      ? applyRateFloor(monthlyRevenueInCents, commissionRateBps)
      : 0;

  const grossSalaryInCents =
    guaranteedComponentInCents + performanceComponentInCents;
  const serviceFeeInCents = applyRateCeil(grossSalaryInCents, serviceFeeRateBps);
  const netSalaryInCents = grossSalaryInCents - serviceFeeInCents;

  return {
    baseGuaranteeInCents,
    thresholdInCents,
    commissionStartInCents,
    commissionRateBps,
    isQualified,
    isGracefulPeriod,
    guaranteedComponentInCents,
    performanceComponentInCents,
    grossSalaryInCents,
    serviceFeeInCents,
    netSalaryInCents,
  };
}