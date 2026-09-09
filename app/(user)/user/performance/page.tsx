"use client";

import { PerformanceStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { usePerformance } from "@/lib/api/hooks";
import { formatCentsToYuan, formatMonth } from "@/lib/format";

export default function UserPerformancePage() {
  const query = usePerformance();

  return (
    <div className="space-y-4">
      <QueryMessage loading={query.isLoading} error={query.error} empty={!query.data?.length} />

      <ul className="space-y-3">
        {query.data?.map((item) => (
          <li key={item.id}>
            <Card className="px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{formatMonth(item.month.slice(0, 7))}</span>
                <PerformanceStatusBadge status={item.status} />
              </div>
              <div className="mt-3 flex items-end justify-between">
                <span className="text-xs text-muted">当月流水</span>
                <span className="text-xl font-semibold tabular-nums tracking-tight">{formatCentsToYuan(item.revenue_cents)}</span>
              </div>
              {item.reject_reason ? (
                <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-danger">
                  驳回原因：{item.reject_reason}
                </p>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}