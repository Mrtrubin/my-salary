"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile, useSchemes } from "@/lib/api/hooks";
import { formatBpsAsPercent, formatCentsToYuan } from "@/lib/format";

export default function UserProfilePage() {
  const profile = useCurrentProfile();
  const schemes = useSchemes();
  const scheme = schemes.data?.find((item) => item.status === "active");

  if (!profile.data) return <QueryMessage loading={profile.isLoading} error={profile.error} />;

  const positions = profile.data.user_positions.flatMap((item) => (item.position ? [item.position] : []));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href="/user/settings"
          aria-label="设置"
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-slate-100"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>

      <Card className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-600">
            {profile.data.name.slice(0, 1)}
          </div>
          <div>
            <p className="text-base font-semibold">{profile.data.name}</p>
            <p className="text-xs text-muted">{profile.data.phone}</p>
          </div>
        </div>

        <dl className="mt-5 space-y-2.5 text-sm">
          <Row label="职位" value={positions.map((item) => item.name).join("、") || "未分配"} />
          <Row label="入职日期" value={profile.data.hire_date} />
        </dl>
      </Card>

      <Card className="px-5 py-5">
        <h2 className="text-sm font-medium">当前工资方案</h2>
        {scheme ? (
          <dl className="mt-3 space-y-2.5 text-sm">
            <Row label="方案" value={`${scheme.name} v${scheme.version}`} />
            <Row label="基本工资" value={formatCentsToYuan(scheme.base_salary_cents)} />
            <Row label="保底工资" value={formatCentsToYuan(scheme.guaranteed_salary_cents)} />
            <Row label="绩效费率" value={formatBpsAsPercent(scheme.commission_rate_bps)} />
          </dl>
        ) : (
          <QueryMessage loading={schemes.isLoading} error={schemes.error} empty />
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}