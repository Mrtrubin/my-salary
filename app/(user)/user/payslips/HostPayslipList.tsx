"use client";

import { useMemo, useState } from "react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useTransitionHostSalaryStatus } from "@/lib/api/hooks";
import type { HostSalaryRecord } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";
import { HostPayslipDetail } from "./HostPayslipDetail";

/**
 * 主持工资条列表：每条压缩为一行（周期 + 团总流水 + 到手收益 + 状态），
 * 点击行打开完整详情面板，避免在列表页堆叠过多字段。
 */
export function HostPayslipList({ records }: { records: HostSalaryRecord[] }) {
  const transition = useTransitionHostSalaryStatus();
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailItem = useMemo(
    () => records.find((item) => item.id === detailId) ?? null,
    [records, detailId],
  );

  if (!records.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">主持工资条</h2>
      <ul className="space-y-3">
        {records.map((item) => (
          <li key={item.id}>
            <Card className="p-0">
              <button
                type="button"
                onClick={() => setDetailId(item.id)}
                aria-label={`查看 ${item.period_start} 至 ${item.period_end} 主持工资条详情`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
              >
                <span className="min-w-0 truncate text-sm">
                  {item.period_start} ~ {item.period_end}
                  <span className="text-muted"> · 团总流水 {formatCentsToYuan(item.revenue_cents)}</span>
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
        <HostPayslipDetail
          item={detailItem}
          onClose={() => setDetailId(null)}
          onConfirm={() =>
            transition.mutate({ id: detailItem.id, status: "confirmed", note: "成员确认收款" })
          }
          confirming={transition.isPending && transition.variables?.id === detailItem.id}
        />
      ) : null}
    </section>
  );
}
