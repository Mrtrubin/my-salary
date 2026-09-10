"use client";

import { useState } from "react";
import { Badge, SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import {
  useConfirmSalaryRecord,
  useCurrentProfile,
  useSalaryRecords,
  useSalaryStatusLogs,
} from "@/lib/api/hooks";
import { formatBpsAsPercent, formatCentsToYuan, formatDateTime, formatMonth } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核",
  pending_confirm: "待确认",
  confirmed: "已确认",
  completed: "已完成",
};

/** 状态变更时间轴（展开时按需加载，精确到秒）。 */
function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useSalaryStatusLogs(recordId);
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs">
      <p className="mb-2 font-medium text-slate-600">状态变更记录</p>
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol className="space-y-1">
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
    </div>
  );
}

export default function UserPayslipsPage() {
  const query = useSalaryRecords();
  const profile = useCurrentProfile();
  const confirm = useConfirmSalaryRecord();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <QueryMessage loading={query.isLoading} error={query.error} empty={!query.data?.length} />

      <ul className="space-y-3">
        {query.data?.map((item) => (
          <li key={item.id}>
            <Card className="px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{formatMonth(item.month.slice(0, 7))}</span>
                <div className="flex gap-1">
                  <Badge tone={item.is_qualified ? "green" : "amber"}>{item.is_qualified ? "达标" : "未达标"}</Badge>
                  <SalaryRecordStatusBadge status={item.status} />
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-muted">实发工资</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${item.net_cents < 0 ? "text-danger" : ""}`}>
                  {formatCentsToYuan(item.net_cents)}
                </p>
              </div>

              <dl className="mt-4 space-y-2.5 text-sm">
             <Row label="当月流水" value={formatCentsToYuan(item.revenue_cents)} />
                <Row label="达标门槛" value={formatCentsToYuan(item.threshold_cents)} />
                <Row label="保障性部分" value={formatCentsToYuan(item.guaranteed_component_cents)} />
                <Row label={`绩效工资（${formatBpsAsPercent(item.commission_rate_bps)}）`} value={formatCentsToYuan(item.performance_component_cents)} />
                <Row label="总工资" value={formatCentsToYuan(item.gross_cents)} />
                <Row label="服务费" value={`−${formatCentsToYuan(item.service_fee_cents)}`} muted />
              </dl>

              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  className="text-xs text-indigo-600"
                >
                  {expanded === item.id ? "收起状态记录" : "查看状态记录"}
                </button>
                {item.status === "pending_confirm" && profile.data?.id ? (
                  <Button
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate({ id: item.id, profileId: profile.data!.id })}
                  >
                    {confirm.isPending ? "确认中…" : "确认收款"}
                  </Button>
                ) : null}
              </div>

              {expanded === item.id ? <StatusTimeline recordId={item.id} /> : null}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular-nums ${muted ? "text-muted" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}