"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TeamPerformanceRow } from "@/lib/api/data";

/** 单张团队每日绩效卡片的聚合数据。 */
export interface DailyGroup {
  key: string;
  teamName: string;
  perfDate: string;
  broadcastMinutes: number;
  rows: TeamPerformanceRow[];
}

/** "YYYY-MM-DD" → "M月D日"。 */
function shortDate(value: string): string {
  const [, m, d] = value.slice(0, 10).split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 开播分钟 → 小时展示（整除去小数）。 */
function toHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** 某成员单条业绩的展示文本（不含名字）。 */
function memberValueText(r: TeamPerformanceRow, showUnit: boolean): string {
  if (r.no_perf) return r.no_perf_note || "停播";
  const amount = r.points_amount.toLocaleString();
  return showUnit && r.point ? `${amount}（${r.point.name}）` : amount;
}

/**
 * 按绩效点分类统计：判断是否只有单一绩效点（决定是否显示单位），
 * 并按点分别汇总总量。停播记录不计入。
 */
function analyze(rows: TeamPerformanceRow[]) {
  const byPoint = new Map<string, { name: string; total: number }>();
  rows.forEach((r) => {
    if (r.no_perf || !r.point_id || !r.point) return;
    const cur = byPoint.get(r.point_id) ?? { name: r.point.name, total: 0 };
    cur.total += r.points_amount;
    byPoint.set(r.point_id, cur);
  });
  const points = Array.from(byPoint.values());
  const singleUnit = points.length <= 1;
  return { points, singleUnit };
}

/** 构造复制到剪贴板的纯文本。 */
function buildCopyText(group: DailyGroup): string {
  const { points, singleUnit } = analyze(group.rows);
  const lines: string[] = [];
  lines.push(`${shortDate(group.perfDate)} ${group.teamName}`);
  lines.push("开播情况汇总");
  lines.push(`总开播时 ${toHours(group.broadcastMinutes)}`);
  lines.push("个人业绩");
  group.rows.forEach((r) => {
    const name = r.profile?.name ?? "";
    if (r.no_perf) {
      lines.push(`${name}：${r.no_perf_note || "停播"}`);
    } else {
      const amount = r.points_amount.toLocaleString();
      const val = singleUnit ? amount : `${amount}（${r.point?.name ?? ""}）`;
      lines.push(`${name}：${val}`);
    }
  });
  if (singleUnit) {
    const total = points[0]?.total ?? 0;
    lines.push(`总${points[0]?.name ?? "音浪"} ${total.toLocaleString()}`);
  } else {
    points.forEach((p) => lines.push(`总${p.name} ${p.total.toLocaleString()}`));
  }
  return lines.join("\n");
}

export function TeamPerformanceCard({
  group,
  onEdit,
}: {
  group: DailyGroup;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { points, singleUnit } = analyze(group.rows);
  const rejected = group.rows.filter((r) => r.status === "rejected");

  const handleCopy = async () => {
    const text = buildCopyText(group);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 降级：使用临时 textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {shortDate(group.perfDate)} {group.teamName}
          {rejected.length ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
              有驳回
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleCopy}>
            {copied ? "已复制" : "复制"}
          </Button>
          {onEdit ? (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              编辑
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <div className="text-xs font-medium text-slate-500">开播情况汇总</div>
        <div className="flex items-center justify-between">
          <span className="text-muted">总开播时</span>
          <span className="tabular-nums">{toHours(group.broadcastMinutes)}</span>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <div className="text-xs font-medium text-slate-500">个人业绩</div>
        {group.rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between">
            <span className="text-muted">{r.profile?.name ?? "—"}</span>
            <span className={`tabular-nums ${r.no_perf ? "text-amber-600" : ""}`}>
              {memberValueText(r, !singleUnit)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1 border-t pt-2 text-sm font-semibold">
        {singleUnit ? (
          <div className="flex items-center justify-between">
            <span>总{points[0]?.name ?? "音浪"}</span>
            <span className="tabular-nums text-indigo-700">
              {(points[0]?.total ?? 0).toLocaleString()}
            </span>
          </div>
        ) : (
          points.map((p) => (
            <div key={p.name} className="flex items-center justify-between">
              <span>总{p.name}</span>
              <span className="tabular-nums text-indigo-700">{p.total.toLocaleString()}</span>
            </div>
          ))
        )}
      </div>

      {rejected.length ? (
        <div className="mt-3 space-y-1 rounded-md bg-red-50 p-3 text-sm">
          <div className="text-xs font-medium text-red-600">管理员驳回</div>
          {rejected.map((r) => (
            <div key={r.id} className="text-red-700">
              {r.profile?.name ?? "—"}：{r.reject_reason || "已驳回"}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}