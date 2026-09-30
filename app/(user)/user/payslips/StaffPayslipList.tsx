"use client";

import { useMemo, useState } from "react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useStaffSalaryStatusLogs, useTransitionStaffSalaryStatus } from "@/lib/api/hooks";
import type { StaffSalaryRecord } from "@/lib/api/data";
import { formatCentsToYuan, formatDateTime } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核",
  pending_confirm: "待确认",
  confirmed: "已确认",
  completed: "已完成",
};

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useStaffSalaryStatusLogs(recordId);
  return (
    <>
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol className="space-y-1.5 text-xs">
        {logs.data?.map((log) => (
          <li key={log.id} className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">{formatDateTime(log.created_at)}</span>
            <span>
              {log.from_status ? `${STATUS_LABELS[log.from_status] ?? log.from_status} → ` : ""}
              {STATUS_LABELS[log.to_status] ?? log.to_status}
            </span>
            {log.operator?.name ? <span className="text-slate-400">· {log.operator.name}</span> : null}
            {log.note ? <span className="text-slate-500">（{log.note}）</span> : null}
          </li>
        ))}
      </ol>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "muted" | "strong" | "danger" | "success" }) {
  const toneClass =
    tone === "muted"
      ? "text-muted"
      : tone === "danger"
        ? "text-danger"
        : tone === "success"
          ? "text-emerald-600"
          : tone === "strong"
            ? "font-semibold text-foreground"
            : "text-foreground";
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

/** 固定薪资工资条（化妆师/舞蹈老师/行政/运镜/人事）：列表 + 全屏详情（成员端确认收款）。 */
export function StaffPayslipList({ records }: { records: StaffSalaryRecord[] }) {
  const transition = useTransitionStaffSalaryStatus();
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailItem = useMemo(() => records.find((item) => item.id === detailId) ?? null, [records, detailId]);

  if (!records.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">固定薪资工资条</h2>
      <ul className="space-y-3">
        {records.map((item) => (
          <li key={item.id}>
            <Card className="p-0">
              <button
                type="button"
                onClick={() => setDetailId(item.id)}
                aria-label={`查看 ${item.period_start} 至 ${item.period_end} 工资条详情`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
              >
                <span className="min-w-0 truncate text-sm">
                  {item.position?.name ?? "固定薪资"} · {item.period_start} ~ {item.period_end}
                  <span className="text-muted"> · 基础 {formatCentsToYuan(item.base_income_cents)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`tabular-nums text-sm font-semibold ${item.net_cents < 0 ? "text-danger" : ""}`}>
                    {formatCentsToYuan(item.net_cents)}
                  </span>
                  <SalaryRecordStatusBadge status={item.status} />
                  <span className="text-xs text-indigo-600">详情</span>
                </span>
              </button>
            </Card>
          </li>
        ))}
      </ul>

      {detailItem ? (
        <div className="fixed inset-0 z-30 flex justify-center bg-slate-900/40">
          <div className="flex h-full w-full max-w-[430px] flex-col bg-slate-50">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200/70 bg-white px-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-semibold">{detailItem.position?.name ?? "固定薪资"}工资条</p>
                <p className="truncate text-xs text-muted">
                  {detailItem.period_start} ~ {detailItem.period_end}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailId(null)}
                className="shrink-0 rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                关闭
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
              <div className="rounded-2xl bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{detailItem.profile?.name ?? "我"}</p>
                  <SalaryRecordStatusBadge status={detailItem.status} />
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-muted">到手收益</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${detailItem.net_cents < 0 ? "text-danger" : ""}`}>
                    {formatCentsToYuan(detailItem.net_cents)}
                  </p>
                </div>
              </div>

              <section className="rounded-2xl bg-white px-4 py-3 shadow-sm shadow-slate-200/60">
                <h3 className="mb-2.5 text-xs font-semibold text-slate-500">收益构成</h3>
                <dl className="space-y-2.5 text-sm">
                  <Row label="基础薪资" value={formatCentsToYuan(detailItem.base_income_cents)} />
                  <Row
                    label="总违约"
                    value={detailItem.penalty_cents ? signedAmount(detailItem.penalty_cents) : "—"}
                    tone={detailItem.penalty_cents ? "danger" : "muted"}
                  />
                  <Row
                    label="总奖励"
                    value={detailItem.reward_cents ? signedAmount(detailItem.reward_cents) : "—"}
                    tone={detailItem.reward_cents ? "success" : "muted"}
                  />
                  <Row
                    label="调整合计"
                    value={detailItem.adjustment_cents ? signedAmount(detailItem.adjustment_cents) : "—"}
                    tone={detailItem.adjustment_cents < 0 ? "danger" : detailItem.adjustment_cents > 0 ? "success" : "muted"}
                  />
                  <Row label="实发收益" value={formatCentsToYuan(detailItem.gross_cents)} />
                  <Row label="个税" value={formatCentsToYuan(detailItem.tax_cents)} tone="muted" />
                  <Row label="到手收益" value={formatCentsToYuan(detailItem.net_cents)} tone="strong" />
                  {detailItem.note ? <Row label="备注" value={detailItem.note} tone="muted" /> : null}
                </dl>
              </section>

              <section className="rounded-2xl bg-white px-4 py-3 shadow-sm shadow-slate-200/60">
                <h3 className="mb-2.5 text-xs font-semibold text-slate-500">状态变更记录</h3>
                <StatusTimeline recordId={detailItem.id} />
              </section>

              {detailItem.status === "pending_confirm" ? (
                <Button
                  className="w-full"
                  disabled={transition.isPending}
                  onClick={() =>
                    transition.mutate({ id: detailItem.id, status: "confirmed", note: "成员确认收款" })
                  }
                >
                  {transition.isPending ? "确认中…" : "确认收款"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
