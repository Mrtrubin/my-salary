"use client";

/**
 * 系统门户首页：默认进入登录页。
 * 已登录用户按角色跳转管理端 / 用户端，未登录跳转登录页。
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentProfile } from "@/lib/api/data";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (cancelled) return;
        if (profile && profile.status === "active") {
          router.replace(profile.system_role === "admin" ? "/admin" : "/user/dashboard");
          return;
        }
      } catch {
        // 读取失败按未登录处理
      }
      if (!cancelled) router.replace("/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <p className="text-sm text-slate-500">正在跳转，请稍候…</p>
    </main>
  );
}
