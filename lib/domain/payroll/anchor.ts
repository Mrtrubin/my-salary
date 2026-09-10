/**
 * 主播工资计算器（阶段5 核心，纯函数、可信端执行）。
 * 落地「保底优先模式」规则：
 *  - 保底基准：无责期(前3月)或上月达标 → 初始保底；第4月起上月不达标 → 降级保底。
 *  - 门槛：thresholdInCents = ceil(保底基准 × thresholdMultiplierBps / 10000)
 *  - 达标：monthlyRevenue >= 门槛
 *  - 保底工资：无论达标与否均发放保底工资全额。
 *  - 阶梯提成：流水 >= 提成起征(保底÷0.2)才计提；固定阶梯 20% 起步，
 *    每 +1万 提点 +1%，最高 +5 点 → 25% 封顶（全额累进：整段流水按该阶梯点计提）。
 *  - 服务费 = ceil(总工资 × serviceFeeRateBps / 10000)
 *  - 实发 = 总工资 − 服务费，允许为负。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { applyRateCeil, applyRateFloor, isWithinGracePeriod } from "./money";
import {
  COMMISSION_STEP_IN_CENTS,
  COMMISSION_STEP_RATE_BPS,
  COMMISSION_MAX_STEPS,
  COMMISSION_BASE_RATE_BPS,
  COMMISSION_CAP_RATE_BPS,
  DEFAULT_SERVICE_FEE_RATE_BPS,
  GRACE_PERIOD_MONTHS,
  type AnchorPayrollInput,
  type AnchorPayrollResult,
} from "./types";

function validateInput(input: AnchorPayrollInput): void {
  const { scheme, monthlyRevenueInCents, tenureMonth } = input;
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
 * 流水每满 1 万元（自 4 万起算）提点 +1%，起始 20%，最高叠加 5 点 → 25% 封顶。
 */
function resolveCommissionRateBps(monthlyRevenueInCents: number): number {
  const steps = Math.max(
    0,
    Math.floor(monthlyRevenueInCents / COMMISSION_STEP_IN_CENTS) - 4,
  );
  const cappedSteps = Math.min(steps, COMMISSION_MAX_STEPS);
  const rateBps = COMMISSION_BASE_RATE_BPS + cappedSteps * COMMISSION_STEP_RATE_BPS;
  return Math.min(rateBps, COMMISSION_CAP_RATE_BPS);
}

/**
 * 计算某主播某月工资明细。纯函数，无副作用，不做负数归零。
 */
export function calculateAnchorPayroll(
  input: AnchorPayrollInput,
): AnchorPayrollResult {
  validateInput(input);

  const { scheme, monthlyRevenueInCents, tenureMonth } = input;
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
      ? resolveCommissionRateBps(monthlyRevenueInCents)
      : 0;
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