"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCurrentProfile } from "@/lib/api/hooks";

export function AuthGuard({ role, children }: { role: "admin" | "user"; children: ReactNode }) {
  const router = useRouter();
  const profile = useCurrentProfile();
  useEffect(() => {
    if (!profile.isLoading && (!profile.data || profile.data.system_role !== role)) router.replace("/login");
  }, [profile.data, profile.isLoading, role, router]);
  if (profile.isLoading) return <div className="p-8 text-sm text-slate-500">正在验证登录状态…</div>;
  if (profile.error) return <div className="p-8 text-sm text-red-600">无法读取账号信息</div>;
  if (!profile.data || profile.data.system_role !== role) return null;
  return children;
}
