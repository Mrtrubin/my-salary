"use client";

import { Button, Tabs } from "antd";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { useTeams } from "@/lib/api/hooks";

function DetailChrome({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const pathname = usePathname();
  const router = useRouter();
  const teams = useTeams();
  const team = teams.data?.find((t) => t.id === teamId);

  const suffix = teamId ? `?teamId=${teamId}` : "";
  const tabs = [
    {
      key: "/admin/teams/detail/members",
      href: `/admin/teams/detail/members${suffix}`,
      label: "成员管理",
    },
    {
      key: "/admin/teams/detail/points",
      href: `/admin/teams/detail/points${suffix}`,
      label: "绩效管理",
    },
    { key: "/admin/settlement", href: "/admin/settlement", label: "系统结算周期" },
  ];
  const activeKey =
    tabs
      .map((tab) => tab.key)
      .filter((key) => pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] ?? tabs[0].key;

  return (
    <>
      <PageHeader
        title={team ? `团队 · ${team.name}` : "团队详情"}
        description={team?.host?.name ? `主持人：${team.host.name}` : "管理团队成员与绩效"}
        action={
          <Button type="link" onClick={() => router.push("/admin/teams")}>
            ← 返回团队列表
          </Button>
        }
      />
      <Tabs
        activeKey={activeKey}
        onChange={(key) => {
          const target = tabs.find((tab) => tab.key === key);
          if (target) router.push(target.href);
        }}
        // label 用 <Link> 渲染真实 href，保留中键 / 右键新标签页打开；
        // onChange 仍保留，方向键切换 tab 时才不会失效。
        items={tabs.map((tab) => ({
          key: tab.key,
          label: <Link href={tab.href}>{tab.label}</Link>,
        }))}
        style={{ marginBottom: 24 }}
      />
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
