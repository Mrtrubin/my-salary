"use client";

import { formatCentsToYuan, formatDurationSeconds, formatMonth } from "@/lib/format";
import type { AnchorEstimate } from "./estimate";

/**
 * ① 本期收益 Hero 卡：一屏内最大字号，明确标注「预估」。
 * 纯展示组件，金额口径全部来自 `estimate`（与结算同源）。
 */
export function EarningsHero({
  month,
  estimate,
  revenueInCents,
  broadcastMinutes,
  activeDays,
  previousNetInCents,
}: {
  /** 本期自然月，"YYYY-MM"。 */
  month: string;
  estimate: AnchorEstimate;
  revenueInCents: number;
  broadcastMinutes: number;
  activeDays: number;
  /** 上一张已发工资条的到手金额，用于环比；无则 null。 */
  previousNetInCents: number | null;
}) {
  const net = estimate.payroll.netSalaryInCents;
  const diff = previousNetInCents === null ? null : net - previousNetInCents;
  const pct =
    diff !== null && previousNetInCents
      ? (diff / Math.abs(previousNetInCents)) * 100
      : null;

  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 px-5 py-6 text-white shadow-lg shadow-indigo-500/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/70">
          {formatMonth(month)} · 预估到手
        </span>
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">预估</span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
        {formatCentsToYuan(net)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/80">
        <span className="tabular-nums">流水 {formatCentsToYuan(revenueInCents)}</span>
        {broadcastMinutes > 0 ? (
          <span className="tabular-nums">已播 {formatDurationSeconds(broadcastMinutes * 60)}</span>
        ) : null}
        {activeDays > 0 ? <span className="tabular-nums">{activeDays} 天</span> : null}
      </div>
      {diff !== null ? (
        <p className="mt-2 text-xs tabular-nums text-white/80">
          较上月 {diff >= 0 ? "↑" : "↓"} {formatCentsToYuan(Math.abs(diff))}
          {pct !== null ? `（${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%）` : ""}
        </p>
      ) : null}
      {revenueInCents === 0 ? (
        <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[11px] leading-relaxed text-white/85">
          本月还没有流水，以上为保底预估；主持人录入后会自动更新。
        </p>
      ) : null}
    </div>
  );
}
