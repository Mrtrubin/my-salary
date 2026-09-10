"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/lib/api/auth";
import { useCurrentProfile } from "@/lib/api/hooks";
import { clearCachedProfile } from "@/lib/api/profile-cache";
import { Logo } from "@/components/logo";

const NAV_ITEMS = [{ href: "/admin", label: "控制台" }, { href: "/admin/members", label: "成员管理" }, { href: "/admin/teams", label: "团队管理" }, { href: "/admin/team-points", label: "绩效点管理" }, { href: "/admin/positions", label: "职位管理" }, { href: "/admin/schemes", label: "工资方案" }, { href: "/admin/review", label: "业绩审核" }, { href: "/admin/team-review", label: "团队审核" }, { href: "/admin/change-requests", label: "资料审核" }, { href: "/admin/payroll", label: "工资核算" }];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useCurrentProfile();
  const queryClient = useQueryClient();
  async function logout() { await signOut(); queryClient.clear(); clearCachedProfile(); router.replace("/login"); }
  return <AuthGuard role="admin"><div className="flex flex-1"><aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-surface"><div className="border-b px-5 py-5"><div className="flex items-center gap-3"><Logo size={40} rounded="rounded-lg" alt=""/><div><p className="text-xs font-medium tracking-widest text-accent">MY SALARY</p><h1 className="mt-1 text-sm font-semibold">薪资核算 · 管理端</h1></div></div></div><nav className="flex-1 space-y-1 px-3 py-4">{NAV_ITEMS.map((item) => { const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={`block rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-secondary hover:text-foreground"}`}>{item.label}</Link>; })}</nav><button type="button" onClick={logout} className="border-t px-5 py-4 text-left text-sm transition-colors hover:bg-surface-secondary"><span className="block font-medium">{profile.data?.name ?? "管理员"}</span><span className="text-xs text-muted">退出登录</span></button></aside><main className="mx-auto min-w-0 max-w-6xl flex-1 px-6 py-8">{children}</main></div></AuthGuard>;
}