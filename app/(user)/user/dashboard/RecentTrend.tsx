"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatCentsToYuan, formatDurationSeconds } from "@/lib/format";
import type { AnchorDailyPoint } from "./estimate";

function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * ③ 近 7 天（mini 柱状图）：日粒度反馈，是主播每天打开 App 的理由。
 * 数据由 `buildRecentDailySeries` 补齐缺失日期，组件只负责画。
 */
export function RecentTrend({ points }: { points: AnchorDailyPoint[] }) {
  const data = points.map((point) => ({
    date: dayLabel(point.date),
    revenue: Number((point.revenueInCents / 100).toFixed(2)),
    minutes: point.broadcastMinutes,
  }));
  const max = Math.max(...data.map((item) => item.revenue), 0);

  // 序列以「今天」结尾，倒数第二个即昨天。
  const today = points[points.length - 1] ?? null;
  const yesterday = points[points.length - 2] ?? null;

  return (
    <section className="rounded-2xl bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
      <h2 className="text-sm font-semibold">近 7 天</h2>

      <div className="mt-3 h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => `¥${Number(value ?? 0).toLocaleString("zh-CN")}`}
              labelFormatter={(label) => `${label} 流水`}
            />
            <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
              {data.map((item) => (
                <Cell
                  key={item.date}
                  fill={item.revenue >= max && max > 0 ? "#4f46e5" : "#a5b4fc"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {yesterday ? (
          <span className="tabular-nums">
            昨天 {formatCentsToYuan(yesterday.revenueInCents)}
            {yesterday.broadcastMinutes > 0
              ? ` · ${formatDurationSeconds(yesterday.broadcastMinutes * 60)}`
              : ""}
          </span>
        ) : null}
        {today ? (
          <span className="tabular-nums">
            今天 {formatCentsToYuan(today.revenueInCents)}
            {today.broadcastMinutes > 0
              ? ` · ${formatDurationSeconds(today.broadcastMinutes * 60)}`
              : ""}
          </span>
        ) : null}
      </div>
    </section>
  );
}
