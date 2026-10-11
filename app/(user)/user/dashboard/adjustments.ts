/**
 * 主播首页「每日调整项」（④）的展示口径（纯函数，可单测）。
 *
 * 输入是 `list_my_anchor_adjustments` RPC 的返回值 —— 四个来源
 * （舞蹈统一表 / 化妆延误 / 主持调整项 / 主持停播）已由 RPC 统一折算为「分」。
 * 本模块只做「清洗 + 排序 + 汇总 + 来源文案」，**不重算任何金额**。
 */

/** 调整项来源 → 「谁记的」展示文案。未知来源原样透出，便于暴露新增来源。 */
export const ADJUSTMENT_SOURCE_LABELS: Readonly<Record<string, string>> = {
  host: "主持",
  dance: "舞蹈老师",
  makeup: "化妆师",
};

export function adjustmentSourceLabel(source: string): string {
  return ADJUSTMENT_SOURCE_LABELS[source] ?? source;
}

/** ④ 的输入行结构（与 `MyAnchorAdjustmentRow` 结构兼容）。 */
export interface AdjustmentLike {
  adjustDate: string;
  name: string;
  amountCents: number;
  source: string;
  note?: string | null;
  registeredName?: string | null;
}

export interface AdjustmentItem {
  /** 调整发生日期，"YYYY-MM-DD"。 */
  date: string;
  name: string;
  /** 有符号金额（分）。 */
  amountCents: number;
  source: string;
  /** 来源展示文案（如「舞蹈老师」）。 */
  sourceLabel: string;
  note: string | null;
  registeredName: string | null;
}

export interface AdjustmentSummary {
  /** 已清洗、按日期倒序的条目。 */
  items: AdjustmentItem[];
  /** 本期合计（分，可正可负）。 */
  totalCents: number;
}

/**
 * 清洗 + 排序 + 汇总每日调整项。
 *
 * 规则（与 `parseAnchorRevenueAdjustments` 的容错口径保持一致）：
 *  - 丢弃非法金额、零值金额与空名称/空日期，避免「-¥0.00」这类噪音；
 *  - 按日期倒序；同日按名称升序，保证渲染稳定（RPC 已排过一次，这里不依赖它）。
 */
export function summarizeAnchorAdjustments(
  rows: readonly AdjustmentLike[],
): AdjustmentSummary {
  const items: AdjustmentItem[] = [];
  for (const row of rows) {
    const amountCents = row.amountCents;
    if (!Number.isFinite(amountCents) || amountCents === 0) continue;
    const name = (row.name ?? "").trim();
    if (!name) continue;
    const date = (row.adjustDate ?? "").slice(0, 10);
    if (!date) continue;
    items.push({
      date,
      name,
      amountCents,
      source: row.source,
      sourceLabel: adjustmentSourceLabel(row.source),
      note: row.note ?? null,
      registeredName: row.registeredName ?? null,
    });
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  return { items, totalCents };
}
