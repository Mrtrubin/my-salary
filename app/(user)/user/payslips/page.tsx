"use client";

import { useMemo, useState } from "react";
import { Badge, SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useConfirmSalaryRecord, useCurrentProfile, useHostSalaryRecords, useMakeupSalaryRecords, useSalaryRecords } from "@/lib/api/hooks";
import { formatBpsAsPercent, formatCentsToYuan } from "@/lib/format";
import { PayslipDetail, periodLabel } from "./PayslipDetail";
import { HostPayslipList } from "./HostPayslipList";
import { MakeupPayslipList } from "./MakeupPayslipList";

export default function UserPayslipsPage() {
  const query = useSalaryRecords();
  const hostQuery = useHostSalaryRecords();
  const makeupQuery = useMakeupSalaryRecords();
  const profile = useCurrentProfile();
  const confirm = useConfirmSalaryRecord();
  const [detailId, setDetailId] = useState<string | null>(null);

  const anchorRecords = query.data ?? [];
  const hostRecords = hostQuery.data ?? [];
  const makeupRecords = makeupQuery.data ?? [];
  // 主播/主持/化妆师工资条共用同一页，任一有数据就不显示「暂无数据」。
  const isEmpty = !anchorRecords.length && !hostRecords.length && !makeupRecords.length;

  // 详情始终从最新列表数据取，确认收款后状态自动同步。
  const detailItem = useMemo(
    () => query.data?.find((item) => item.id === detailId) ?? null,
    [query.data, detailId],
  );

  return (
    <div className="space-y-4">
      <QueryMessage
        loading={query.isLoading || hostQuery.isLoading || makeupQuery.isLoading}
        error={query.error || hostQuery.error || makeupQuery.error}
        empty={isEmpty}
      />

      <ul className="space-y-3">
        {anchorRecords.map((item) => (
          <li key={item.id}>
            <Card className="p-0">
              <button
                type="button"
                onClick={() => setDetailId(item.id)}
                aria-label={`查看 ${periodLabel(item)} 完整工资条`}
                className="w-full px-5 py-4 text-left transition-colors hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold">{periodLabel(item)}</p>
                    <p className="truncate text-xs text-muted">
                      {item.team_id === null ? "系统结算" : item.team?.name ?? "团队信息缺失"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge tone={item.is_qualified ? "green" : "amber"}>{item.is_qualified ? "达标" : "未达标"}</Badge>
                    <SalaryRecordStatusBadge status={item.status} />
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-muted">到手工资</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${item.net_cents < 0 ? "text-danger" : ""}`}>
                    {formatCentsToYuan(item.net_cents)}
                  </p>
                </div>

                <dl className="mt-4 space-y-2.5 text-sm">
                  <Row label="周期流水" value={formatCentsToYuan(item.revenue_cents)} />
                  <Row label="保障性部分" value={formatCentsToYuan(item.guaranteed_component_cents)} />
                  <Row
                    label={`绩效工资（${formatBpsAsPercent(item.commission_rate_bps)}）`}
                    value={formatCentsToYuan(item.performance_component_cents)}
                  />
                </dl>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-xs text-indigo-600">查看完整工资条</span>
                  {item.status === "pending_confirm" ? (
                    <span className="text-xs text-amber-600">待你确认收款</span>
                  ) : null}
                </div>
              </button>
            </Card>
          </li>
        ))}
      </ul>

      <HostPayslipList records={hostRecords} />

      <MakeupPayslipList records={makeupRecords} />

      {detailItem ? (
        <PayslipDetail
          item={detailItem}
          onClose={() => setDetailId(null)}
          onConfirm={
            profile.data?.id
              ? () => confirm.mutate({ id: detailItem.id, profileId: profile.data!.id })
              : undefined
          }
          confirming={confirm.isPending}
        />
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}