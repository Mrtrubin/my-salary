"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TeamPerformanceRow } from "@/lib/api/data";
import { buildPerformanceCopyText, toHoursText, type PerfCopyMember } from "./performanceCopy";
import { buildRevenueRecordFields, sumRevenueBreakdown } from "@/lib/domain/performance/recordView";
import { formatCentsToYuan } from "@/lib/format";

/** 单张团队每日绩效卡片的聚合数据。 */
export interface DailyGroup {
  key: string;
  teamName: string;
  /** 团队 ID（teams.team_code）；多个团可重复。 */
  teamCode: string;
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
  return toHoursText(minutes);
}

/** 某成员单条业绩的展示文本（不含名字）。 */
function memberValueText(r: TeamPerformanceRow, showUnit: boolean): string {
  if (r.no_perf) return r.no_perf_note || "休息";
  const amount = r.points_amount.toLocaleString();
  return showUnit && r.point ? `${amount}（${r.point.name}）` : amount;
}

/**
 * 按绩效点分类统计：判断是否只有单一绩效点（决定是否显示单位），
 * 并按点分别汇总总量。休息记录不计入。
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

/** 构造复制到剪贴板的纯文本（与上传页提交汇总同格式）。 */
function buildCopyText(group: DailyGroup): string {
  const members: PerfCopyMember[] = group.rows.map((r) => ({
    name: r.profile?.name ?? "",
    noPerf: r.no_perf,
    note: r.no_perf_note,
    pointsAmount: r.points_amount,
    pointId: r.point_id,
    pointName: r.point?.name ?? null,
  }));
  return buildPerformanceCopyText({
    perfDate: group.perfDate,
    teamName: group.teamName,
    broadcastMinutes: group.broadcastMinutes,
    members,
  });
}

function signedCents(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

/** 单条流水的完整字段弹窗。 */
function RecordDetailModal({ record, onClose }: { record: TeamPerformanceRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">流水详情</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>
        <dl className="space-y-2.5 text-sm">
          {buildRevenueRecordFields(record).map((field) => (
            <div key={field.label} className="flex items-start justify-between gap-3">
              <dt className="text-xs text-muted">{field.label}</dt>
              <dd className="tabular-nums text-foreground">{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function TeamPerformanceCard({
  group,
  onEdit,
}: {
  group: DailyGroup;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<TeamPerformanceRow | null>(null);
  const { points, singleUnit } = analyze(group.rows);
  const breakdown = sumRevenueBreakdown(group.rows);

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
          {group.teamCode ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">ID：{group.teamCode}</span>
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
        {group.rows[0]?.host?.name ? (
          <div className="flex items-center justify-between">
            <span className="text-muted">录入主持</span>
            <span>{group.rows[0].host.name}</span>
          </div>
        ) : null}
      </div>

      {/* 当日流水 / 总调整项 / 当日最终流水 */}
      <div className="mt-3 space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">当日流水</span>
          <span className="tabular-nums">{formatCentsToYuan(breakdown.baseCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">总调整项</span>
          <span className={`tabular-nums ${breakdown.adjustmentCents < 0 ? "text-danger" : breakdown.adjustmentCents > 0 ? "text-emerald-600" : "text-muted"}`}>
            {breakdown.adjustmentCents === 0 ? "—" : signedCents(breakdown.adjustmentCents)}
          </span>
        </div>
        <div className="flex items-center justify-between font-semibold">
          <span>当日最终流水</span>
          <span className="tabular-nums text-indigo-700">{formatCentsToYuan(breakdown.finalCents)}</span>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <div className="text-xs font-medium text-slate-500">个人业绩（点击查看详情）</div>
        {group.rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setDetail(r)}
            className="flex w-full items-center justify-between rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-slate-50"
          >
            <span className="text-muted">{r.profile?.name ?? "—"}</span>
            <span className={`tabular-nums ${r.no_perf ? "text-amber-600" : ""}`}>
              {memberValueText(r, !singleUnit)}
            </span>
          </button>
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

      {detail ? <RecordDetailModal record={detail} onClose={() => setDetail(null)} /> : null}
    </Card>
  );
}
