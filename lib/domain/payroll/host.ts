/**
 * 主持工资计算器（纯函数、可信端执行）。
 *
 * 与主播「保底/提成互斥」不同，主持按「团总流水」整体计提，规则（已与产品确认）：
 *  - 拿提点门槛：配置值，团总流水 >= 门槛 视为达标。
 *  - 是否达标：团总流水 >= 拿提点门槛 → 是；否则 → 否。
 *  - 阶梯式提点：以门槛为基准，团总流水每超出 10 万元 +1 个百分点，
 *    不满 10 万不计；最高额外 +3 个点；未达门槛时为 0 点。
 *    steps = MAX(0, MIN(3, FLOOR((团总流水 − 门槛) / 100000)))
 *  - 最终提成率 = 基础提成率 + 阶梯式提点（均为百分点）。
 *  - 基础收益：配置的固定保底金额，仅在未达标时计入。
 *  - 调整合计 = 总违约 + 总奖励（可正可负）。
 *  - 实发收益：达标 = 团总流水 × 最终提成率 + 调整合计；未达标 = 基础收益 + 调整合计。
 *  - 服务费 = ceil(实发收益 × 服务率)。
 *  - 到手收益 = 实发收益 − 服务费（允许为负，不归零）。
 *
 * 金额一律以「分」为单位整数，比例以「基点」(bps) 表示（10000 bps = 100%）。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import type { AmountInCents, RateInBps } from "@/lib/api/contracts/common";
import { applyRateCeil, applyRateFloor } from "./money";
import type { PayrollAdjustment } from "./adjustment";

/** 每超出 10 万元（分）：100000 元 × 100 = 10,000,000 分。 */
export const HOST_TIER_STEP_IN_CENTS: AmountInCents = 10_000_000;
/** 每档阶梯提点增量：1 个百分点 = 100 bps。 */
export const HOST_TIER_STEP_RATE_BPS: RateInBps = 100;
/** 阶梯式提点最多额外叠加档数：最高 +3 个点。 */
export const HOST_MAX_TIER_STEPS = 3;

/** 违约调整项名称（扣除，金额为负）。 */
export const HOST_PENALTY_NAME = "违约";
/** 奖励调整项名称（增加，金额为正）。 */
export const HOST_REWARD_NAME = "奖励";

/** 主持快捷调整预设：违约（扣）与奖励（加），金额由管理员填写。 */
export function getHostAdjustmentPresets(): PayrollAdjustment[] {
  return [
    { name: HOST_PENALTY_NAME, amountCents: 0 },
    { name: HOST_REWARD_NAME, amountCents: 0 },
  ];
}

/** 主持工资方案（管理端「主持管理」按人配置，配置化非硬编码）。 */
export interface HostSalaryScheme {
  /** 基础收益（分）：未达标时的固定保底金额。 */
  baseIncomeInCents: AmountInCents;
  /** 拿提点门槛（分）：团总流水达到该值才算达标并计提成。 */
  commissionStartInCents: AmountInCents;
  /** 基础提成率（基点），默认 20% = 2000 bps。 */
  baseCommissionRateBps: RateInBps;
  /** 服务率（基点），默认 3% = 300 bps。 */
  serviceFeeRateBps: RateInBps;
}

/** 单次主持工资计算输入。 */
export interface HostPayrollInput {
  scheme: HostSalaryScheme;
  /** 团总流水（分）：该主持本周期跨团队流水合计。 */
  teamRevenueInCents: AmountInCents;
  /** 调整合计（分）：总违约（负）+ 总奖励（正），默认 0。 */
  adjustmentTotalInCents?: AmountInCents;
}

/** 主持工资计算明细结果（全部为分/基点）。 */
export interface HostPayrollResult {
  /** 拿提点门槛（= 方案配置值）。 */
  thresholdInCents: AmountInCents;
  /** 是否达标。 */
  isQualified: boolean;
  /** 基础提成率（基点）。 */
  baseCommissionRateBps: RateInBps;
  /** 阶梯式提点数（0~3）。 */
  tierSteps: number;
  /** 阶梯式提点（基点，0/100/200/300）。 */
  tierBonusBps: RateInBps;
  /** 最终提成率（基点）= 基础提成率 + 阶梯式提点。 */
  commissionRateBps: RateInBps;
  /** 基础收益（分）：方案配置的固定保底金额（无论是否达标均展示）。 */
  baseIncomeInCents: AmountInCents;
  /** 本次实际计入的基础收益（分）：未达标 = 配置值，达标 = 0。 */
  baseIncomeComponentInCents: AmountInCents;
  /** 调整合计（分）。 */
  adjustmentTotalInCents: AmountInCents;
  /** 提成部分（分）：达标 = floor(团总流水 × 最终提成率)，未达标 = 0。 */
  performanceComponentInCents: AmountInCents;
  /** 实发收益（分）= 计入的基础收益 + 提成部分 + 调整合计。 */
  grossIncomeInCents: AmountInCents;
  /** 服务率（基点）。 */
  serviceFeeRateBps: RateInBps;
  /** 服务费（分）= ceil(实发收益 × 服务率)。 */
  serviceFeeInCents: AmountInCents;
  /** 到手收益（分）= 实发收益 − 服务费。 */
  netIncomeInCents: AmountInCents;
}

function assertInteger(value: number, name: string, min = 0): void {
  if (!Number.isInteger(value) || value < min) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, `${name}须为不小于 ${min} 的整数`);
  }
}

function validateScheme(scheme: HostSalaryScheme): void {
  assertInteger(scheme.baseIncomeInCents, "基础收益");
  assertInteger(scheme.commissionStartInCents, "拿提点门槛");
  if (!Number.isInteger(scheme.baseCommissionRateBps) || scheme.baseCommissionRateBps <= 0 || scheme.baseCommissionRateBps > 10000) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础提成率范围为 0.01%～100%");
  }
  if (!Number.isInteger(scheme.serviceFeeRateBps) || scheme.serviceFeeRateBps < 0 || scheme.serviceFeeRateBps > 10000) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "服务率范围为 0%～100%");
  }
}

/**
 * 计算阶梯式提点档数：以拿提点门槛为基准，每超出 10 万元 +1 档，
 * 不满 10 万不计，最高 3 档；未达门槛为 0 档。
 */
export function resolveHostTierSteps(
  teamRevenueInCents: AmountInCents,
  thresholdInCents: AmountInCents,
): number {
  if (teamRevenueInCents < thresholdInCents) return 0;
  const over = teamRevenueInCents - thresholdInCents;
  const steps = Math.floor(over / HOST_TIER_STEP_IN_CENTS);
  return Math.max(0, Math.min(HOST_MAX_TIER_STEPS, steps));
}

/**
 * 计算某主持某周期工资明细。纯函数，无副作用，不做负数归零。
 */
export function calculateHostPayroll(input: HostPayrollInput): HostPayrollResult {
  const { scheme, teamRevenueInCents, adjustmentTotalInCents = 0 } = input;
  validateScheme(scheme);
  assertInteger(teamRevenueInCents, "团总流水");
  if (!Number.isInteger(adjustmentTotalInCents)) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "调整合计须为整数分");
  }

  const thresholdInCents = scheme.commissionStartInCents;
  const isQualified = teamRevenueInCents >= thresholdInCents;
  const tierSteps = resolveHostTierSteps(teamRevenueInCents, thresholdInCents);
  const tierBonusBps = tierSteps * HOST_TIER_STEP_RATE_BPS;
  const commissionRateBps = scheme.baseCommissionRateBps + tierBonusBps;

  // 达标走提成，未达标走基础收益；两者互斥。
  const performanceComponentInCents = isQualified
    ? applyRateFloor(teamRevenueInCents, commissionRateBps)
    : 0;
  const baseIncomeComponentInCents = isQualified ? 0 : scheme.baseIncomeInCents;

  const grossIncomeInCents =
    baseIncomeComponentInCents + performanceComponentInCents + adjustmentTotalInCents;
  const serviceFeeInCents = applyRateCeil(grossIncomeInCents, scheme.serviceFeeRateBps);
  const netIncomeInCents = grossIncomeInCents - serviceFeeInCents;

  return {
    thresholdInCents,
    isQualified,
    baseCommissionRateBps: scheme.baseCommissionRateBps,
    tierSteps,
    tierBonusBps,
    commissionRateBps,
    baseIncomeInCents: scheme.baseIncomeInCents,
    baseIncomeComponentInCents,
    adjustmentTotalInCents,
    performanceComponentInCents,
    grossIncomeInCents,
    serviceFeeRateBps: scheme.serviceFeeRateBps,
    serviceFeeInCents,
    netIncomeInCents,
  };
}
