/**
 * 主播工资计算器（阶段5 核心，纯函数、可信端执行）。
 * 落地已确认规则 1/2/3/4：
 *  - 门槛：thresholdInCents = ceil(基本工资 × thresholdMultiplierBps / 10000)
 *  - 达标：monthlyRevenue >= 门槛
 *  - 前3月（无责）：达标 → 基本 + 绩效；不达标 → 基本
 *  - 第4月起：达标 → 基本 + 绩效；不达标 → 保底
 *  - 绩效工资 = floor(全部月流水 × commissionRateBps / 10000)（规则2）
 *  - 服务费 = ceil(总工资 × serviceFeeRateBps / 10000)（规则3）
 *  - 实发 = 总工资 − 服务费，允许为负（规则4）
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { applyRateCeil, applyRateFloor, isWithinGracePeriod } from "./money";
import {
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
    !Number.isInteger(scheme.commissionRateBps) ||
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
 * 计算某主播某月工资明细。纯函数，无副作用，不做负数归零。
 */
export function calculateAnchorPayroll(
  input: AnchorPayrollInput,
): AnchorPayrollResult {
  validateInput(input);

  const { scheme, monthlyRevenueInCents, tenureMonth } = input;
  const serviceFeeRateBps = input.serviceFeeRateBps ?? DEFAULT_SERVICE_FEE_RATE_BPS;

  // 达标门槛：基本工资 × 系数（向上取整到分）。
  const thresholdInCents = applyRateCeil(
    scheme.baseSalaryInCents,
    scheme.thresholdMultiplierBps,
  );
  const isQualified = monthlyRevenueInCents >= thresholdInCents;
  const isGracefulPeriod = isWithinGracePeriod(tenureMonth, GRACE_PERIOD_MONTHS);

  // 保障性部分：达标或无责期 → 基本；否则（第4月起不达标）→ 保底。
  const guaranteedComponentInCents =
    isQualified || isGracefulPeriod
      ? scheme.baseSalaryInCents
      : scheme.guaranteedSalaryInCents;

  // 绩效工资：仅达标发放，按全部月流水计提（规则2）。
  const performanceComponentInCents = isQualified
    ? applyRateFloor(monthlyRevenueInCents, scheme.commissionRateBps)
    : 0;

  const grossSalaryInCents =
    guaranteedComponentInCents + performanceComponentInCents;
  const serviceFeeInCents = applyRateCeil(grossSalaryInCents, serviceFeeRateBps);
  const netSalaryInCents = grossSalaryInCents - serviceFeeInCents;

  return {
    thresholdInCents,
    isQualified,
    isGracefulPeriod,
    guaranteedComponentInCents,
    performanceComponentInCents,
    grossSalaryInCents,
    serviceFeeInCents,
    netSalaryInCents,
  };
}