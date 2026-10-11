"use client";

import { QueryMessage } from "@/components/query-message";
import { useSalaryRecords } from "@/lib/api/hooks";
import { formatCentsToYuan, formatMonth } from "@/lib/format";

/**
 * 主播概览（保底/提成互斥模式）。
 *
 * 自取数据、自渲染；与主持概览（HostDashboard）互不依赖，两者不共享任何组件或查询。
 */
export function AnchorDashboard() {
  const salary = useSalaryRecords();
  const latestSalary = salary.data?.[0];

  return (
    <div className="space-y-5">
      <QueryMessage loading={salary.isLoading} error={salary.error} />

      {latestSalary ? (
        <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 px-5 py-6 text-white shadow-lg shadow-indigo-500/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/70">{formatMonth(latestSalary.month.slice(0, 7))} 实发</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">最新</span>
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatCentsToYuan(latestSalary.net_cents)}</p>
        </div>
      ) : null}
    </div>
  );
}
