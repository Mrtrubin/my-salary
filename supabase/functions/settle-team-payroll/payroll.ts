/**
 * 主播工资计算（Deno 版，与 lib/domain/payroll/anchor.ts 同口径）。
 * 金额以「分」整数存储，比例以「基点」(bps) 表示（10000 bps = 100%）。
 * 规则：
 *  - 门槛 = ceil(基本工资 × thresholdMultiplierBps / 10000)
 *  - 前 3 月无责：达标→基本+绩效，不达标→基本；第 4 月起：达标→基本+绩效，不达标→保底
 *  - 绩效 = floor(全部月流水 × commissionRateBps / 10000)，仅达标发放
 *  - 服务费 = ceil(总工资 × serviceFeeRateBps / 10000)，实发 = 总工资 − 服务费（允许为负）
 */
const DEFAULT_SERVICE_FEE_RATE_BPS = 300;
const GRACE_PERIOD_MONTHS = 3;

export interface PayrollScheme {
  baseSalaryInCents: number;
  guaranteedSalaryInCents: number;
  thresholdMultiplierBps: number;
  commissionRateBps: number;
}

export interface PayrollInput {
  scheme: PayrollScheme;
  monthlyRevenueInCents: number;
  tenureMonth: number;
  serviceFeeRateBps?: number;
}

export interface PayrollResult {
  thresholdInCents: number;
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

export function computePayroll(input: PayrollInput): PayrollResult {
  const { scheme, monthlyRevenueInCents, tenureMonth } = input;
  const serviceFeeRateBps = input.serviceFeeRateBps ?? DEFAULT_SERVICE_FEE_RATE_BPS;

  const thresholdInCents = applyRateCeil(
    scheme.baseSalaryInCents,
    scheme.thresholdMultiplierBps,
  );
  const isQualified = monthlyRevenueInCents >= thresholdInCents;
  const isGracefulPeriod = tenureMonth <= GRACE_PERIOD_MONTHS;

  const guaranteedComponentInCents =
    isQualified || isGracefulPeriod
      ? scheme.baseSalaryInCents
      : scheme.guaranteedSalaryInCents;

  const performanceComponentInCents = isQualified
    ? applyRateFloor(monthlyRevenueInCents, scheme.commissionRateBps)
    : 0;

  const grossSalaryInCents = guaranteedComponentInCents + performanceComponentInCents;
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