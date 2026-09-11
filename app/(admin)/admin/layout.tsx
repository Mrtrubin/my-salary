"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/lib/api/auth";
import { useCurrentProfile } from "@/lib/api/hooks";
import { clearCachedProfile } from "@/lib/api/profile-cache";
import { Logo } from "@/components/logo";

const NAV_ITEMS = [
  { href: "/admin", label: "控制台", icon: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9" },
  { href: "/admin/members", label: "成员管理", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0" },
  { href: "/admin/teams", label: "团队管理", icon: "M9 3h6v6H9zM3 15h6v6H3zM15 15h6v6h-6zM12 9v3M6 15v-3h12v3" },
  { href: "/admin/team-points", label: "绩效点管理", icon: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" },
  { href: "/admin/positions", label: "职位管理", icon: "M3 7h18v14H3zM8 7V3h8v4M3 12l9 3 9-3M12 12v5" },
  { href: "/admin/schemes", label: "工资方案", icon: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8" },
  { href: "/admin/settlement", label: "系统结算周期", icon: "M8 2v4M16 2v4M3 10h18M3 4h18v18H3zM8 14h3M8 18h7" },
  { href: "/admin/anchor-revenue", label: "主播流水", icon: "M3 3v18h18M7 16l4-5 4 2 6-8M17 5h4v4" },
  { href: "/admin/team-review", label: "团队审核", icon: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3ZM8 12l3 3 5-6" },
  { href: "/admin/change-requests", label: "资料审核", icon: "M9 5H5v16h14V5h-4M9 3h6v4H9zM8 14l3 3 5-6" },
  { href: "/admin/payroll", label: "工资核算", icon: "M5 3h14v18H5zM8 7h8M8 11h1M15 11h1M8 15h1M15 15h1M8 18h1M15 18h1" },
];

function SidebarIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useCurrentProfile();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const labelVisibility = collapsed ? "hidden" : "block";

  async function logout() {
    await signOut();
    queryClient.clear();
    clearCachedProfile();
    router.replace("/login");
  }

  return (
    <AuthGuard role="admin">
      <div className="flex min-h-dvh w-full min-w-0 flex-1">
        <div className={`sticky top-0 z-40 h-dvh shrink-0 motion-safe:transition-[width] motion-safe:duration-200 ${collapsed ? "w-16" : "w-56"}`}>
          <aside className="absolute inset-0 flex flex-col border-r bg-surface">
            <div className="shrink-0 border-b px-3 py-4">
              <div className="flex h-10 items-center gap-3 overflow-hidden whitespace-nowrap">
                <div className="shrink-0"><Logo size={40} rounded="rounded-lg" alt="" /></div>
                <div className={labelVisibility}>
                  <p className="text-xs font-medium tracking-widest text-accent">MY SALARY</p>
                  <h1 className="mt-1 text-sm font-semibold">薪资核算 · 管理端</h1>
                </div>
              </div>
              <button
                type="button"
                aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                aria-expanded={!collapsed}
                aria-controls="admin-navigation"
                title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                onClick={() => setCollapsed((value) => !value)}
                className="absolute -right-4 top-14 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:bg-surface-secondary"
              >
                <svg aria-hidden="true" className={`h-4 w-4 motion-safe:transition-transform motion-safe:duration-200 ${collapsed ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m14 7-5 5 5 5" />
                </svg>
              </button>
            </div>
            <nav id="admin-navigation" aria-label="管理员导航" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-4">
              {NAV_ITEMS.map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-secondary hover:text-foreground"}`}
                  >
                    <SidebarIcon path={item.icon} />
                    <span className={`whitespace-nowrap ${labelVisibility}`}>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={logout}
              aria-label={`${profile.data?.name ?? "管理员"}，退出登录`}
              title={`${profile.data?.name ?? "管理员"} · 退出登录`}
              className="flex min-h-20 shrink-0 items-center gap-3 border-t px-5 py-4 text-left text-sm transition-colors hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent"
            >
              <SidebarIcon path="M9 5H4v14h5M9 12h12m-4-4 4 4-4 4" />
              <span className={`min-w-0 ${labelVisibility}`}>
                <span className="block truncate font-medium">{profile.data?.name ?? "管理员"}</span>
                <span className="whitespace-nowrap text-xs text-muted">退出登录</span>
              </span>
            </button>
          </aside>
        </div>
        <main className="min-w-0 flex-1 overflow-x-auto px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}