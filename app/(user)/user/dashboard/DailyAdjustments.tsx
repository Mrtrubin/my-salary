"use client";

import { useMemo } from "react";
import { useMyAnchorAdjustments } from "@/lib/api/hooks";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { formatCentsToYuan } from "@/lib/format";
import { summarizeAnchorAdjustments } from "./adjustments";

/** "2026-10-07" → "10-07"（列表内不重复年份）。 */
function monthDayLabel(date: string): string {
  const [, m, d] = date.slice(0, 10).split("-");
  return `${m}-${d}`;
}

/** 金额配色：扣减用红、奖励用绿，与主持上传端一致。 */
function amountClass(amountCents: number): string {
  if (amountCents < 0) return "text-red-600";
  if (amountCents > 0) return "text-emerald-600";
  return "text-slate-600";
}

/**
 * ④ 每日调整项：按日倒序列出本期**所有**与自己有关的调整项（不论由谁登记 ——
 * 主持 / 舞蹈老师 / 化妆师），不必等结算。**只读、不折叠、不提供申诉入口**。
 *
 * 数据全部来自 `list_my_anchor_adjustments` RPC（四来源已统一折算为「分」）。
 * 加载中 / 请求失败 / 无内容时**整块不渲染**，不影响首页其余部分。
 */
export function DailyAdjustments({ range }: { range: PeriodRange }) {
  const query = useMyAnchorAdjustments(range);
  const summary = useMemo(() => summarizeAnchorAdjustments(query.data ?? []), [query.data]);

  if (query.isLoading || query.error || summary.items.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">每日调整项</h2>
        <span className="text-xs text-muted">{summary.items.length} 项</span>
      </div>

      <ul className="mt-3 divide-y divide-slate-100 text-xs">
        {summary.items.map((item, index) => (
          <li
            key={`${item.date}-${item.source}-${item.name}-${index}`}
            className="flex items-start justify-between gap-3 py-2"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-slate-700">
                <span className="tabular-nums text-muted">{monthDayLabel(item.date)}</span>
                {" · "}
                {item.name}
                <span className="text-muted">（{item.sourceLabel}）</span>
              </p>
              {item.note ? (
                <p className="truncate text-[11px] text-muted">{item.note}</p>
              ) : null}
            </div>
            <span
              className={`shrink-0 font-medium tabular-nums ${amountClass(item.amountCents)}`}
            >
              {item.amountCents > 0 ? "+" : ""}
              {formatCentsToYuan(item.amountCents)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
        <span className="text-slate-600">
          本期合计
          <span className={`ml-1 font-semibold tabular-nums ${amountClass(summary.totalCents)}`}>
            {summary.totalCents > 0 ? "+" : ""}
            {formatCentsToYuan(summary.totalCents)}
          </span>
        </span>
        <span className="text-[11px] text-muted">以结算为准</span>
      </div>
    </section>
  );
}
