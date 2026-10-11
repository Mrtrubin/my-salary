/**
 * 主播首页「本期预估」口径（纯函数，可单测）。
 *
 * 核心原则：金额口径只能有一套。本模块不重写任何工资公式，
 * 只在 [`calculateAnchorPayroll()`](lib/domain/payroll/anchor.ts:94) 之上做外层组合，
 * 保证首页预估值与结算落库值同源、不会漂移。
 */
import { calculateAnchorPayroll } from "@/lib/domain/payroll/anchor";
import { addDays } from "@/lib/domain/settlement/cycle";
import {
  COMMISSION_MAX_STEPS,
  COMMISSION_STEP_IN_CENTS,
  COMMISSION_STEP_RATE_BPS,
  type AnchorPayrollResult,
  type AnchorSalaryScheme,
} from "@/lib/domain/payroll/types";

/** 目标进度所处阶段。 */
export type AnchorGoalStage =
  | "belowThreshold" // 未达保底门槛
  | "belowCommission" // 已达标但未进入提成模式
  | "inCommission" // 提成模式中，尚未满档
  | "maxStep"; // 已达最高阶梯

export interface AnchorGoal {
  stage: AnchorGoalStage;
  /** 距离下一里程碑还需的当月流水（分）；maxStep 为 0。 */
  remainingInCents: number;
  /** 下一档提成率（基点）；仅 inCommission 阶段有值。 */
  nextRateBps: number | null;
  /** 当前区间内的进度比例 0~1（用于进度条）。 */
  progressRatio: number;
}

export interface AnchorEstimate {
  /** 与结算同源的工资明细（预估）。 */
  payroll: AnchorPayrollResult;
  /** 目标进度。 */
  goal: AnchorGoal;
}

export interface AnchorEstimateInput {
  scheme: AnchorSalaryScheme;
  monthlyRevenueInCents: number;
  tenureMonth: number;
  attendanceBonusBps?: number;
  dyTaskBonusBps?: number;
  baseCommissionRateBps?: number;
  serviceFeeRateBps?: number;
}

/** 首页可用的最小流水行结构（与 `listMyAnchorRevenue` 返回值结构兼容）。 */
export interface AnchorRevenueLike {
  perfDate: string;
  revenueCents: number;
  broadcastMinutes: number;
  noPerf: boolean;
}

export interface AnchorPeriodSummary {
  revenueInCents: number;
  broadcastMinutes: number;
  /** 有实际业绩（流水或时长 > 0）的天数。 */
  activeDays: number;
}

export interface AnchorDailyPoint {
  date: string;
  revenueInCents: number;
  broadcastMinutes: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

/**
 * 计算目标进度：门槛 → 拿提点门槛 → 超过拿提点门槛每满 1 万元升 1 档（最多 5 档）。
 * 金额门槛一律取自工资计算结果，避免与结算口径出现第二套公式。
 */
export function resolveAnchorGoal(
  monthlyRevenueInCents: number,
  payroll: AnchorPayrollResult,
): AnchorGoal {
  const { thresholdInCents, commissionStartInCents, commissionRateBps } = payroll;

  if (monthlyRevenueInCents < thresholdInCents) {
    return {
      stage: "belowThreshold",
      remainingInCents: thresholdInCents - monthlyRevenueInCents,
      nextRateBps: null,
      progressRatio: clamp01(thresholdInCents === 0 ? 1 : monthlyRevenueInCents / thresholdInCents),
    };
  }

  if (monthlyRevenueInCents < commissionStartInCents) {
    const span = commissionStartInCents - thresholdInCents;
    return {
      stage: "belowCommission",
      remainingInCents: commissionStartInCents - monthlyRevenueInCents,
      nextRateBps: null,
      progressRatio: clamp01(span === 0 ? 1 : (monthlyRevenueInCents - thresholdInCents) / span),
    };
  }

  const over = monthlyRevenueInCents - commissionStartInCents;
  const steps = Math.min(
    Math.floor(over / COMMISSION_STEP_IN_CENTS),
    COMMISSION_MAX_STEPS,
  );
  if (steps >= COMMISSION_MAX_STEPS) {
    return { stage: "maxStep", remainingInCents: 0, nextRateBps: null, progressRatio: 1 };
  }
  return {
    stage: "inCommission",
    remainingInCents: (steps + 1) * COMMISSION_STEP_IN_CENTS - over,
    nextRateBps: commissionRateBps + COMMISSION_STEP_RATE_BPS,
    progressRatio: clamp01(
      (over - steps * COMMISSION_STEP_IN_CENTS) / COMMISSION_STEP_IN_CENTS,
    ),
  };
}

/** 主播本期预估：工资明细 + 目标进度。 */
export function estimateAnchorPayroll(input: AnchorEstimateInput): AnchorEstimate {
  const payroll = calculateAnchorPayroll({
    scheme: input.scheme,
    monthlyRevenueInCents: input.monthlyRevenueInCents,
    tenureMonth: input.tenureMonth,
    attendanceBonusBps: input.attendanceBonusBps,
    dyTaskBonusBps: input.dyTaskBonusBps,
    baseCommissionRateBps: input.baseCommissionRateBps,
    serviceFeeRateBps: input.serviceFeeRateBps,
  });
  return {
    payroll,
    goal: resolveAnchorGoal(input.monthlyRevenueInCents, payroll),
  };
}

/** 汇总区间流水：跳过无绩效记录，累加流水与时长，并统计有业绩天数。 */
export function summarizeAnchorRevenue(
  rows: readonly AnchorRevenueLike[],
): AnchorPeriodSummary {
  let revenueInCents = 0;
  let broadcastMinutes = 0;
  const activeDates = new Set<string>();
  for (const row of rows) {
    if (row.noPerf) continue;
    revenueInCents += row.revenueCents;
    broadcastMinutes += row.broadcastMinutes;
    if (row.revenueCents > 0 || row.broadcastMinutes > 0) activeDates.add(row.perfDate);
  }
  return { revenueInCents, broadcastMinutes, activeDays: activeDates.size };
}

/**
 * 生成「截至 endDate 的最近 days 天」每日序列，缺失日期补 0，供柱状图直接消费。
 * 同日多条记录累加。
 */
export function buildRecentDailySeries(
  rows: readonly AnchorRevenueLike[],
  endDate: string,
  days = 7,
): AnchorDailyPoint[] {
  const byDate = new Map<string, AnchorDailyPoint>();
  for (const row of rows) {
    if (row.noPerf) continue;
    const point = byDate.get(row.perfDate) ?? {
      date: row.perfDate,
      revenueInCents: 0,
      broadcastMinutes: 0,
    };
    point.revenueInCents += row.revenueCents;
    point.broadcastMinutes += row.broadcastMinutes;
    byDate.set(row.perfDate, point);
  }
  const series: AnchorDailyPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(endDate, -offset);
    series.push(byDate.get(date) ?? { date, revenueInCents: 0, broadcastMinutes: 0 });
  }
  return series;
}
