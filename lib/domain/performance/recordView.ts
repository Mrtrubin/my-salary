/**
 * 流水记录的口径与详情字段（成员端与管理端共用）。
 *
 * 口径：
 *   当日最终流水 = revenue_cents（已含调整项）
 *   当日调整项   = adjustment_cents
 *   当日流水     = revenue_cents − adjustment_cents
 */
import { formatCentsToYuan, formatDateTime, formatDurationSeconds } from "@/lib/format";

export interface RevenueRecordLike {
  perf_date: string;
  points_amount: number;
  revenue_cents: number;
  adjustment_cents: number;
  broadcast_minutes: number;
  no_perf: boolean;
  no_perf_note: string | null;
  created_at?: string | null;
  team?: { name: string; team_code: string } | null;
  point?: { name: string } | null;
  profile?: { name: string } | null;
  host?: { name: string } | null;
}

export interface RevenueBreakdown {
  /** 当日流水（业绩折算，不含调整项）。 */
  baseCents: number;
  /** 当日调整项（分，可正可负）。 */
  adjustmentCents: number;
  /** 当日最终流水（含调整项）。 */
  finalCents: number;
}

export function revenueBreakdown(
  record: Pick<RevenueRecordLike, "revenue_cents" | "adjustment_cents">,
): RevenueBreakdown {
  return {
    baseCents: record.revenue_cents - record.adjustment_cents,
    adjustmentCents: record.adjustment_cents,
    finalCents: record.revenue_cents,
  };
}

/** 汇总一组记录的当日流水 / 总调整项 / 最终流水。 */
export function sumRevenueBreakdown(records: Pick<RevenueRecordLike, "revenue_cents" | "adjustment_cents">[]): RevenueBreakdown {
  const adjustmentCents = records.reduce((sum, r) => sum + r.adjustment_cents, 0);
  const finalCents = records.reduce((sum, r) => sum + r.revenue_cents, 0);
  return { baseCents: finalCents - adjustmentCents, adjustmentCents, finalCents };
}

/** 单条记录的完整展示字段（详情弹窗用）。 */
export function buildRevenueRecordFields(record: RevenueRecordLike): { label: string; value: string }[] {
  const { baseCents, adjustmentCents, finalCents } = revenueBreakdown(record);
  const fields: { label: string; value: string }[] = [
    { label: "绩效日期", value: record.perf_date },
    { label: "团队", value: record.team ? `${record.team.name}（${record.team.team_code}）` : "—" },
    { label: "成员", value: record.profile?.name ?? "—" },
    { label: "录入主持", value: record.host?.name ?? "—" },
    { label: "绩效点", value: record.no_perf ? (record.no_perf_note || "休息") : (record.point?.name ?? "—") },
    { label: "业绩", value: record.no_perf ? "—" : record.points_amount.toLocaleString() },
    { label: "直播时长", value: record.broadcast_minutes > 0 ? formatDurationSeconds(record.broadcast_minutes * 60) : "—" },
    { label: "当日流水", value: formatCentsToYuan(baseCents) },
    { label: "当日调整项", value: formatCentsToYuan(adjustmentCents) },
    { label: "当日最终流水", value: formatCentsToYuan(finalCents) },
  ];
  if (record.created_at) fields.push({ label: "录入时间", value: formatDateTime(record.created_at) });
  return fields;
}
