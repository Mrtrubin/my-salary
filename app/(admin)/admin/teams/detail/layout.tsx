"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/stat-card";
import { useTeams } from "@/lib/api/hooks";

function DetailChrome({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const pathname = usePathname();
  const teams = useTeams();
  const team = teams.data?.find((t) => t.id === teamId);

  const suffix = teamId ? `?teamId=${teamId}` : "";
  const tabs = [
    { key: "/admin/teams/detail/members", href: `/admin/teams/detail/members${suffix}`, label: "成员管理" },
    { key: "/admin/teams/detail/points", href: `/admin/teams/detail/points${suffix}`, label: "绩效管理" },
    { key: "/admin/teams/detail/settlement", href: `/admin/teams/detail/settlement${suffix}`, label: "结算周期" },
  ];

  return (
    <>
      <PageHeader
        title={team ? `团队 · ${team.name}` : "团队详情"}
        description={team?.host?.name ? `主持人：${team.host.name}` : "管理团队成员与绩效"}
        action={<Link href="/admin/teams" className="rounded px-3 py-1.5 text-sm text-muted hover:text-foreground">← 返回团队列表</Link>}
      />
      <div className="mb-6 flex gap-1 border-b">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.key);
          return (
            <Link key={tab.key} href={tab.href} className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${active ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground"}`}>{tab.label}</Link>
          );
        })}
      </div>
      {children}
    </>
  );
}

export default function TeamDetailLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DetailChrome>{children}</DetailChrome>
    </Suspense>
  );
}