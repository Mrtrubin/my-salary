"use client";

import { useMemo } from "react";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile, useSalaryRecords } from "@/lib/api/hooks";
import { formatCentsToYuan, formatMonth } from "@/lib/format";
import { HostDashboard } from "./HostDashboard";

export default function UserDashboardPage() {
  const profile = useCurrentProfile();
  const isHost = useMemo(
    () => profile.data?.user_roles?.some(({ role }) => role?.code === "host") ?? false,
    [profile.data],
  );

  if (profile.isLoading) return <QueryMessage loading error={profile.error} />;
  if (profile.data && isHost) return <HostDashboard profile={profile.data} />;
  return <AnchorDashboard />;
}

function AnchorDashboard() {
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
