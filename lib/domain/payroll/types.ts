/**
 * 主播工资引擎领域类型（阶段5）。
 * 金额一律以「分」为单位的整数存储；比例以「基点」(bps) 表示（10000 bps = 100%）。
 * 参考已确认规则：
 *  - 规则1：管理员按人设基本工资/保底工资；达标门槛 = 基本工资 × 2.65；
 *    前3个月无责（达标发基本+绩效、不达标发基本）；第4月起（达标发基本+绩效、不达标发保底）。
 *  - 规则2：绩效工资=超额提成，按「全部月流水」计提。
 *  - 规则3：服务费 = ceil(总工资 × 3%)，实发 = 总工资 − 服务费，对全员扣除。
 *  - 规则4：不做负数归零，按实际结果输出。
 */
import type { AmountInCents, RateInBps } from "@/lib/api/contracts/common";

/** 主播工资方案（管理员按人配置，配置化非硬编码）。 */
export interface AnchorSalaryScheme {
  /** 基本工资（分）。示例 8000 元 = 800000 分。 */
  baseSalaryInCents: AmountInCents;
  /** 保底工资（分）。示例 5000 元 = 500000 分。 */
  guaranteedSalaryInCents: AmountInCents;
  /**
   * 达标门槛系数（基点）。基本达标流水 = 基本工资 × 系数。
   * 规则1 示例：基本 × (1.65 + 1) = 基本 × 2.65 → 26500 bps。
   */
  thresholdMultiplierBps: RateInBps;
  /** 绩效提成费率（基点），作用于全部月流水（规则2）。 */
  commissionRateBps: RateInBps;
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
  /** 服务费费率（基点），默认 300 bps = 3%（规则3）。 */
  serviceFeeRateBps?: RateInBps;
}

/** 工资计算的明细结果（全部为分）。 */
export interface AnchorPayrollResult {
  /** 达标门槛（基本达标流水）。 */
  thresholdInCents: AmountInCents;
  /** 是否达标（当月流水 >= 门槛）。 */
  isQualified: boolean;
  /** 是否处于无责期（前3个月）。 */
  isGracefulPeriod: boolean;
  /** 保障性工资部分（基本或保底，取决于月序与达标）。 */
  guaranteedComponentInCents: AmountInCents;
  /** 绩效工资（超额提成，未达标为 0）。 */
  performanceComponentInCents: AmountInCents;
  /** 总工资 = 保障性部分 + 绩效工资。 */
  grossSalaryInCents: AmountInCents;
  /** 服务费 = ceil(总工资 × 费率)。 */
  serviceFeeInCents: AmountInCents;
  /** 实发 = 总工资 − 服务费（规则4：允许为负，不归零）。 */
  netSalaryInCents: AmountInCents;
}

/** 默认服务费费率：3% = 300 bps（规则3）。 */
export const DEFAULT_SERVICE_FEE_RATE_BPS: RateInBps = 300;

/** 无责期月数上限（前3个月）。 */
export const GRACE_PERIOD_MONTHS = 3;