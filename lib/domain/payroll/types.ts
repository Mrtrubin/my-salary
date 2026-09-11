/**
 * 主播工资引擎领域类型（阶段5）。
 * 金额一律以「分」为单位的整数存储；比例以「基点」(bps) 表示（10000 bps = 100%）。
 *
 * 薪资模式：保底/提成互斥模式
 *  - 门槛（保底达标门槛）= 初始保底 × thresholdMultiplierBps（固定用初始保底），达标判定按当月流水。
 *  - 基础收益（保底工资）：当月达标 → 初始保底；不达标 → 降级保底。
 *  - 拿提点门槛（提成起征）= 初始保底 × 5（固定用初始保底），无责期同样适用。
 *  - 提成互斥：当月流水 >= 拿提点门槛 → 总工资 = 总流水 × 最终提成率（不叠加保底工资）；
 *    否则 → 总工资 = 保底工资全额（无提成）。
 *  - 阶梯提成：20% 起步，超过拿提点门槛的流水每满 1万 提点 +1%，最高叠加 5 个百分点；最终提成率不封顶。
 *  - 服务费：所有主播实际流水业绩统一扣除 3% 平台服务费。
 *
 * 说明：达标判定与保底基准均以「当月流水」为准，不再依赖上月达标标记。
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
  /** 考勤加点（基点），默认 0；1 个百分点 = 100 bps。 */
  attendanceBonusBps?: RateInBps;
  /** dy 任务加点（基点），默认 0。 */
  dyTaskBonusBps?: RateInBps;
  /** 主播基础提成率（基点），默认 2000 bps = 20%。 */
  baseCommissionRateBps?: RateInBps;
  /** 服务费费率（基点），默认 300 bps = 3%。 */
  serviceFeeRateBps?: RateInBps;
}

/** 工资计算的明细结果（全部为分）。 */
export interface AnchorPayrollResult {
  /** 本月保底基准（基础收益）：当月达标为初始保底，否则为降级保底。 */
  baseGuaranteeInCents: AmountInCents;
  /** 保底达标门槛 = 初始保底 × 系数（固定用初始保底）。 */
  thresholdInCents: AmountInCents;
  /** 拿提点门槛（提成起征）= 初始保底 × 5（固定）。 */
  commissionStartInCents: AmountInCents;
  /** 本次实际采用的最终提成费率（基点，不封顶；仅阶梯加点封顶 500 bps）。 */
  commissionRateBps: RateInBps;
  /**
   * 本次采用的基础提成率（基点），用于持久化快照。
   * 阶梯提点 = commissionRateBps − 本字段 − 考勤加点 − dy任务加点。
   */
  baseCommissionRateBps: RateInBps;
  /** 是否达标（当月流水 >= 门槛）。 */
  isQualified: boolean;
  /** 是否处于无责期（前3个月）。 */
  isGracefulPeriod: boolean;
  /** 保障性工资部分：保底模式下为保底工资全额，提成模式下为 0。 */
  guaranteedComponentInCents: AmountInCents;
  /** 绩效工资（提成模式下 = 总流水 × 最终提成率；保底模式下为 0）。 */
  performanceComponentInCents: AmountInCents;
  /** 总工资：提成模式 = 绩效工资；保底模式 = 保底工资。 */
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

/** 阶梯提成起步点：20% = 2000 bps。 */
export const COMMISSION_BASE_RATE_BPS: RateInBps = 2000;
/** 每档流水增量（1 万元，单位分），每满一档提点 +1%。 */
export const COMMISSION_STEP_IN_CENTS: AmountInCents = 1_000_000;
/** 每档提点增量：1% = 100 bps。 */
export const COMMISSION_STEP_RATE_BPS: RateInBps = 100;
/** 最多叠加档数：最高 +5 点。 */
export const COMMISSION_MAX_STEPS = 5;
