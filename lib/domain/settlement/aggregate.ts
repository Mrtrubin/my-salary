/**
 * 团队结算聚合（PLAN-001 阶段2，纯函数、可测）。
 *
 * 职责：给定某团队某结算周期内的成员流水明细 + 各成员工资方案 + 入职日期，
 * 逐成员聚合周期内流水，计算在职月序，调用主播工资计算器
 * [`calculateAnchorPayroll()`](lib/domain/payroll/anchor.ts:44)，
 * 产出可直接 upsert 进 salary_records 的草稿数据（含 period_start/end）。
 *
 * 说明：本层不触库、无副作用；数据读取与写入由 Edge Function / data 层负责。
 */
import { calculateAnchorPayroll } from "@/lib/domain/payroll/anchor";
import type { AnchorSalaryScheme } from "@/lib/domain/payroll/types";
import type { PeriodRange } from "./cycle";

/** 单条周期内流水明细（已按 approved 过滤，perf_date 落在周期内）。 */
export interface SettlementPerfRow {
  profileId: string;
  perfDate: string;
  revenueCents: number;
  /** 录入时间（ISO），可选。当前聚合不再依赖它去重（DB 已保证每日唯一）。 */
  createdAt?: string;
}

/** 成员结算上下文：工资方案 + 岗位 + 入职日期。 */
export interface SettlementMemberContext {
  profileId: string;
  positionId: number;
  schemeId: string | null;
  /**
   * 工资方案。为 null 表示该成员尚未配置生效方案：
   * 此时仅聚合其周期内流水用于展示，不参与工资计算（工资相关字段置 0）。
   */
  scheme: AnchorSalaryScheme | null;
  /** 上月是否达标（决定第4月起本月保底基准），可选，默认 true。 */
  lastMonthQualified?: boolean;
  /** 入职日期 `YYYY-MM-DD`，用于计算在职月序。 */
  hireDate: string;
}

/** 聚合产出：可 upsert 进 salary_records 的一条草稿。 */
export interface SettlementDraft {
  profileId: string;
  positionId: number;
  schemeId: string | null;
  /** 是否已配置生效工资方案。false 时工资相关字段均为 0，仅 revenueCents 有效。 */
  hasScheme: boolean;
  /** 归属月（周期起始日所在自然月的 1 号），满足 salary_records.month 约束。 */
  month: string;
  periodStart: string;
  periodEnd: string;
  revenueCents: number;
  tenureMonth: number;
  baseGuaranteeCents: number;
  thresholdCents: number;
  commissionStartCents: number;
  commissionRateBps: number;
  isQualified: boolean;
  isGracePeriod: boolean;
  guaranteedComponentCents: number;
  performanceComponentCents: number;
  grossCents: number;
  serviceFeeCents: number;
  netCents: number;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map((s) => Number(s));
  return [y, m, d];
}

/**
 * 计算在职月序（从 1 开始）：以入职日到周期止日跨越的自然月数 + 1。
 * 例：入职 2026-01-10，周期止日 2026-03-20 → (3-1) 个月差 + 1 = 3（第 3 个月，仍无责期）。
 * 若周期止日早于入职日，返回 1（视为首月）。
 */
export function calcTenureMonth(hireDate: string, periodEnd: string): number {
  const [hy, hm] = parts(hireDate);
  const [ey, em] = parts(periodEnd);
  const monthDiff = (ey - hy) * 12 + (em - hm);
  return monthDiff < 0 ? 1 : monthDiff + 1;
}

/** 周期起始日所在自然月的 1 号（作为 salary_records.month）。 */
function periodMonth(periodStart: string): string {
  const [y, m] = parts(periodStart);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * 聚合某团队某周期的结算草稿。
 * @param period 结算周期区间（含端点）
 * @param members 参与结算的成员上下文（通常为团队当前成员）
 * @param perfRows 周期内 approved 流水明细
 * @param serviceFeeRateBps 服务费率（默认走计算器内置 300 bps）
 */
export function aggregateSettlement(
  period: PeriodRange,
  members: SettlementMemberContext[],
  perfRows: SettlementPerfRow[],
  serviceFeeRateBps?: number,
): SettlementDraft[] {
  // 按成员汇总周期内流水。
  // DB 唯一约束 (team_id, perf_date, profile_id) 保证每日每主播仅一条，故直接累加。
  const revenueByProfile = new Map<string, number>();
  for (const row of perfRows) {
    if (row.perfDate < period.start || row.perfDate > period.end) continue;
    revenueByProfile.set(
      row.profileId,
      (revenueByProfile.get(row.profileId) ?? 0) + row.revenueCents,
    );
  }

  const month = periodMonth(period.start);

  return members.map((member) => {
    const revenueCents = revenueByProfile.get(member.profileId) ?? 0;
    const tenureMonth = calcTenureMonth(member.hireDate, period.end);
    // 无生效方案：仅保留流水用于展示，工资相关字段全部置 0，不参与结算。
    if (!member.scheme) {
      return {
        profileId: member.profileId,
        positionId: member.positionId,
        schemeId: member.schemeId,
        hasScheme: false,
        month,
        periodStart: period.start,
        periodEnd: period.end,
        revenueCents,
        tenureMonth,
        baseGuaranteeCents: 0,
        thresholdCents: 0,
        commissionStartCents: 0,
        commissionRateBps: 0,
        isQualified: false,
        isGracePeriod: false,
        guaranteedComponentCents: 0,
        performanceComponentCents: 0,
        grossCents: 0,
        serviceFeeCents: 0,
        netCents: 0,
      };
    }
    const result = calculateAnchorPayroll({
      scheme: member.scheme,
      monthlyRevenueInCents: revenueCents,
      tenureMonth,
      lastMonthQualified: member.lastMonthQualified,
      serviceFeeRateBps,
    });
    return {
      profileId: member.profileId,
      positionId: member.positionId,
      schemeId: member.schemeId,
      hasScheme: true,
      month,
      periodStart: period.start,
      periodEnd: period.end,
      revenueCents,
      tenureMonth,
      baseGuaranteeCents: result.baseGuaranteeInCents,
      thresholdCents: result.thresholdInCents,
      commissionStartCents: result.commissionStartInCents,
      commissionRateBps: result.commissionRateBps,
      isQualified: result.isQualified,
      isGracePeriod: result.isGracefulPeriod,
      guaranteedComponentCents: result.guaranteedComponentInCents,
      performanceComponentCents: result.performanceComponentInCents,
      grossCents: result.grossSalaryInCents,
      serviceFeeCents: result.serviceFeeInCents,
      netCents: result.netSalaryInCents,
    };
  });
}