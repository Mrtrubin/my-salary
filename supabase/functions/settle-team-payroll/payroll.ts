/**
 * 主播工资计算（Deno 版，与 lib/domain/payroll/anchor.ts 同口径）。
 * 金额以「分」整数存储，比例以「基点」(bps) 表示（10000 bps = 100%）。
 * 「保底/提成互斥模式」规则：
 *  - 门槛 = ceil(初始保底 × thresholdMultiplierBps / 10000)，达标判定按当月流水
 *  - 基础收益（保底工资）：当月达标 → 初始保底；不达标 → 降级保底
 *  - 拿提点门槛（提成起征）= 初始保底 × 5（固定），无责期同样适用
 *  - 提成互斥：流水 >= 拿提点门槛 → 总工资 = 总流水 × 最终提成率（不叠加保底工资）；否则 = 保底工资全额
 *  - 阶梯提成：20% 起步，超过拿提点门槛每满 1万 +1%，阶梯加点封顶 5%，最终提成率不封顶
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
  /** 本次采用的基础提成率（基点），用于持久化快照。 */
  baseCommissionRateBps: number;
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

  // 门槛固定用「初始保底 × 系数」计算，达标判定按当月流水。
  const thresholdInCents = applyRateCeil(
    scheme.baseSalaryInCents,
    scheme.thresholdMultiplierBps,
  );
  const isQualified = monthlyRevenueInCents >= thresholdInCents;

  // 基础收益：当月达标 → 初始保底；不达标 → 降级保底。
  const baseGuaranteeInCents = isQualified
    ? scheme.baseSalaryInCents
    : scheme.guaranteedSalaryInCents;

  // 拿提点门槛（提成起征）= 初始保底 × 5（固定），无责期同样适用。
  const commissionStartInCents = scheme.baseSalaryInCents * 5;

  const commissionRateBps =
    monthlyRevenueInCents >= commissionStartInCents
      ? resolveCommissionRateBps(monthlyRevenueInCents, commissionStartInCents, baseCommissionRateBps)
      : 0;

  // 提成互斥：达拿提点门槛走提成模式（总工资=总流水×提成率），否则走保底模式。
  const isCommissionMode = commissionRateBps > 0;
  const performanceComponentInCents = isCommissionMode
    ? applyRateFloor(monthlyRevenueInCents, commissionRateBps)
    : 0;
  const guaranteedComponentInCents = isCommissionMode ? 0 : baseGuaranteeInCents;

  const grossSalaryInCents = guaranteedComponentInCents + performanceComponentInCents;
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