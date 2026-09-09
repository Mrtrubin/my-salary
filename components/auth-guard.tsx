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
  // 已有缓存数据时直接放行（后台可静默重新验证），避免切换页面时闪现占位符
  if (profile.data) return profile.data.system_role === role ? children : null;
  if (profile.error) return <div className="p-8 text-sm text-red-600">无法读取账号信息</div>;
  return null;
}
