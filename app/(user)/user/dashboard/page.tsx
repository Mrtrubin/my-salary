"use client";

import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile, usePerformance, useSalaryRecords } from "@/lib/api/hooks";
import { formatCentsToYuan, formatDate, formatMonth } from "@/lib/format";

export default function UserDashboardPage() {
  const profile = useCurrentProfile();
  const performance = usePerformance();
  const salary = useSalaryRecords();
  const latestPerformance = performance.data?.[0];
  const latestSalary = salary.data?.[0];
  const loading = profile.isLoading || performance.isLoading || salary.isLoading;
  const error = profile.error || performance.error || salary.error;

  return (
    <div className="space-y-5">
      <QueryMessage loading={loading} error={error} />

      {latestSalary ? (
        <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 px-5 py-6 text-white shadow-lg shadow-indigo-500/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/70">{formatMonth(latestSalary.month.slice(0, 7))} 实发</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">最新</span>
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatCentsToYuan(latestSalary.net_cents)}</p>
        </div>
      ) : null}

      <Card className="px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">最近业绩</h2>
          {latestPerformance ? (
            <span className="text-xs text-muted">{formatDate(latestPerformance.month)}</span>
          ) : null}
        </div>
        {latestPerformance ? (
          <p className="mt-2 text-xl font-semibold tabular-nums">{formatCentsToYuan(latestPerformance.revenue_cents)}</p>
        ) : (
          <p className="mt-2 text-sm text-muted">暂无业绩</p>
        )}
      </Card>
    </div>
  );
}