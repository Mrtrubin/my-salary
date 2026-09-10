/**
 * 主播工资引擎领域类型（阶段5）。
 * 金额一律以「分」为单位的整数存储；比例以「基点」(bps) 表示（10000 bps = 100%）。
 *
 * 薪资模式：保底优先模式
 *  - 保底工资 = 基本工资 + 超额阶梯提成
 *  - 规则1（保底达标门槛）：保底达标流水 = 保底 × 1.65 + 保底 = 保底 × 2.65；
 *    当月流水 >= 门槛 → 拿满保底；否则不保底（仍拿保底工资全额，无提成）。
 *  - 规则2（提成起征）：提成起始流水 = 保底 ÷ 0.2；低于此不提成。
 *  - 规则3（阶梯提成）：固定阶梯，20% 起步，流水每 +1万 提点 +1%，最高叠加 5 个点 → 25% 封顶。
 *  - 规则4（服务费）：所有主播实际流水业绩统一扣除 3% 平台服务费。
 *
 * 保底基准的动态取值：
 *  - 入职前 3 个月（无责期）：按初始保底 = baseSalaryInCents 计。
 *  - 第 4 个月起：上月达标 → 继续按初始保底；上月不达标 → 按 guaranteedSalaryInCents 计。
 */
import type { AmountInCents, RateInBps } from "@/lib/api/contracts/common";

/** 主播工资方案（管理员按人配置，配置化非硬编码）。 */
export interface AnchorSalaryScheme {
  /** 初始保底（分）。示例 8000 元 = 800000 分。无责期及上月达标时作为保底基准。 */
  baseSalaryInCents: AmountInCents;
  /** 降级保底（分）。第 4 月起上月不达标时的保底基准。示例 5000 元 = 500000 分。 */
  guaranteedSalaryInCents: AmountInCents;
  /**
   * 保底达标门槛系数（基点）。保底达标流水 = 保底基准 × 系数。
   * 规则1 示例：保底 × (1.65 + 1) = 保底 × 2.65 → 26500 bps。
   */
  thresholdMultiplierBps: RateInBps;
}

/** 单次工资计算的输入。 */
export interface AnchorPayrollInput {
  scheme: AnchorSalaryScheme;
  /** 当月全部流水（分）。 */
  monthlyRevenueInCents: AmountInCents;
  /**
   * 在职月序（从 1 开始）：1~3 为无责期，>=4 进入正常期。
   * 由入职日期与结算月运行时计算得出。
   */
  tenureMonth: number;
  /**
   * 上月是否达标（决定第 4 月起本月保底基准取初始保底还是降级保底）。
   * 无责期（tenureMonth <= 3）时忽略。默认为 true（按初始保底）。
   */
  lastMonthQualified?: boolean;
  /** 服务费费率（基点），默认 300 bps = 3%。 */
  serviceFeeRateBps?: RateInBps;
}

/** 工资计算的明细结果（全部为分）。 */
export interface AnchorPayrollResult {
  /** 本月保底基准（初始保底或降级保底，取决于月序与上月达标）。 */
  baseGuaranteeInCents: AmountInCents;
  /** 保底达标门槛 = 保底基准 × 系数。 */
  thresholdInCents: AmountInCents;
  /** 提成起征流水 = 保底基准 ÷ 0.2。 */
  commissionStartInCents: AmountInCents;
  /** 本次实际采用的提成费率（基点，阶梯计算得出，封顶 2500 bps）。 */
  commissionRateBps: RateInBps;
  /** 是否达标（当月流水 >= 门槛）。 */
  isQualified: boolean;
  /** 是否处于无责期（前3个月）。 */
  isGracefulPeriod: boolean;
  /** 保障性工资部分（保底工资全额，无论是否达标均发放）。 */
  guaranteedComponentInCents: AmountInCents;
  /** 绩效工资（阶梯提成，流水低于提成起征时为 0）。 */
  performanceComponentInCents: AmountInCents;
  /** 总工资 = 保底工资 + 阶梯提成。 */
  grossSalaryInCents: AmountInCents;
  /** 服务费 = ceil(总工资 × 费率)。 */
  serviceFeeInCents: AmountInCents;
  /** 实发 = 总工资 − 服务费（允许为负，不归零）。 */
  netSalaryInCents: AmountInCents;
}

/** 默认服务费费率：3% = 300 bps。 */
export const DEFAULT_SERVICE_FEE_RATE_BPS: RateInBps = 300;

/** 无责期月数上限（前3个月）。 */
export const GRACE_PERIOD_MONTHS = 3;

/** 阶梯提成起点流水（4 万元，单位分）。低于此不做提成。 */
export const COMMISSION_FLOOR_IN_CENTS: AmountInCents = 4_000_000;
/** 阶梯提成起步点：20% = 2000 bps。 */
export const COMMISSION_BASE_RATE_BPS: RateInBps = 2000;
/** 每档流水增量（1 万元，单位分），每满一档提点 +1%。 */
export const COMMISSION_STEP_IN_CENTS: AmountInCents = 1_000_000;
/** 每档提点增量：1% = 100 bps。 */
export const COMMISSION_STEP_RATE_BPS: RateInBps = 100;
/** 最多叠加档数：最高 +5 点。 */
export const COMMISSION_MAX_STEPS = 5;
/** 阶梯提成封顶：25% = 2500 bps。 */
export const COMMISSION_CAP_RATE_BPS: RateInBps = 2500;