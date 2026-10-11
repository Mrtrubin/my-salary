"use client";

import { useMemo, useState } from "react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useHostSalaryRecords, useTransitionHostSalaryStatus } from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";
import { HostPayslipDetail } from "./HostPayslipDetail";
import { HOST_ROLE_CODE, useMyRoleCodes } from "./roles";

/**
 * 主持工资条（按团总流水整体计提）。
 *
 * 自取数据、自渲染；与主播（AnchorPayslipList）、固定薪资（StaffPayslipList）互不依赖。
 * 每条压缩为一行（周期 + 团总流水 + 到手收益 + 状态），点击行打开完整详情面板。
 */
export function HostPayslipList() {
  const roleCodes = useMyRoleCodes();
  const query = useHostSalaryRecords();
  const transition = useTransitionHostSalaryStatus();
  const [detailId, setDetailId] = useState<string | null>(null);

  // 固定引用，避免 `?? []` 每次渲染产生新数组导致下方 useMemo 失效。
  const records = useMemo(() => query.data ?? [], [query.data]);
  const detailItem = useMemo(
    () => records.find((item) => item.id === detailId) ?? null,
    [records, detailId],
  );

  // 未持有主持角色时不渲染本区块。
  if (!roleCodes.has(HOST_ROLE_CODE)) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">主持工资条</h2>
      <QueryMessage loading={query.isLoading} error={query.error} empty={!records.length} />

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
