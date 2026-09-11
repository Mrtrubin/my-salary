/**
 * 主播工资计算（Deno 版，与 lib/domain/payroll/anchor.ts 同口径）。
 * 金额以「分」整数存储，比例以「基点」(bps) 表示（10000 bps = 100%）。
 * 「保底优先模式」规则：
 *  - 保底基准：无责期(前3月)或上月达标 → 初始保底；第4月起上月不达标 → 降级保底
 *  - 门槛 = ceil(保底基准 × thresholdMultiplierBps / 10000)
 *  - 保底工资 = 保底基准全额（无论达标与否）
 *  - 阶梯提成：流水 >= 保底基准 ÷ 0.2 才计提；20% 起步，超过拿提点门槛每满 1万 +1%，阶梯加点封顶 5%，最终提成率不封顶
 *  - 服务费 = ceil(总工资 × serviceFeeRateBps / 10000)，实发 = 总工资 − 服务费（允许为负）
 */
const DEFAULT_SERVICE_FEE_RATE_BPS = 300;
const GRACE_PERIOD_MONTHS = 3;

const COMMISSION_STEP_IN_CENTS = 1000000;
const COMMISSION_STEP_RATE_BPS = 100;
const COMMISSION_MAX_STEPS = 5;
const DEFAULT_COMMISSION_BASE_RATE_BPS = 2000;

export interface PayrollScheme {
  baseSalaryInCents: number;
  guaranteedSalaryInCents: number;
  thresholdMultiplierBps: number;
}

export interface PayrollInput {
  scheme: PayrollScheme;
  monthlyRevenueInCents: number;
  tenureMonth: number;
  lastMonthQualified?: boolean;
  baseCommissionRateBps?: number;
  serviceFeeRateBps?: number;
}

export interface PayrollResult {
  baseGuaranteeInCents: number;
  thresholdInCents: number;
  commissionStartInCents: number;
  commissionRateBps: number;
  isQualified: boolean;
  isGracefulPeriod: boolean;
  guaranteedComponentInCents: number;
  performanceComponentInCents: number;
  grossSalaryInCents: number;
  serviceFeeInCents: number;
  netSalaryInCents: number;
}

function applyRateCeil(amount: number, rateBps: number): number {
  return Math.ceil((amount * rateBps) / 10000);
}

function applyRateFloor(amount: number, rateBps: number): number {
  return Math.floor((amount * rateBps) / 10000);
}

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

export function computePayroll(input: PayrollInput): PayrollResult {
  const { scheme, monthlyRevenueInCents, tenureMonth } = input;
  const baseCommissionRateBps = input.baseCommissionRateBps ?? DEFAULT_COMMISSION_BASE_RATE_BPS;
  const serviceFeeRateBps = input.serviceFeeRateBps ?? DEFAULT_SERVICE_FEE_RATE_BPS;
  if (!Number.isInteger(baseCommissionRateBps) || baseCommissionRateBps < 1 || baseCommissionRateBps > 10000) {
    throw new Error("基础提成率必须在 0.01%～100% 之间");
  }
  const isGracefulPeriod = tenureMonth <= GRACE_PERIOD_MONTHS;

  const lastMonthQualified = input.lastMonthQualified ?? true;
  const baseGuaranteeInCents =
    isGracefulPeriod || lastMonthQualified
      ? scheme.baseSalaryInCents
      : scheme.guaranteedSalaryInCents;

  const thresholdInCents = applyRateCeil(
    baseGuaranteeInCents,
    scheme.thresholdMultiplierBps,
  );
  const isQualified = monthlyRevenueInCents >= thresholdInCents;

  const commissionStartInCents = baseGuaranteeInCents * 5;

  const guaranteedComponentInCents = baseGuaranteeInCents;

  const commissionRateBps =
    monthlyRevenueInCents >= commissionStartInCents
      ? resolveCommissionRateBps(monthlyRevenueInCents, commissionStartInCents, baseCommissionRateBps)
      : 0;
  const performanceComponentInCents =
    commissionRateBps > 0
      ? applyRateFloor(monthlyRevenueInCents, commissionRateBps)
      : 0;

  const grossSalaryInCents = guaranteedComponentInCents + performanceComponentInCents;
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