"use client";

import { Badge, SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useSalaryRecords } from "@/lib/api/hooks";
import { formatBpsAsPercent, formatCentsToYuan, formatMonth } from "@/lib/format";

export default function UserPayslipsPage() {
  const query = useSalaryRecords();

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