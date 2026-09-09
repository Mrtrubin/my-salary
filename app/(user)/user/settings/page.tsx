"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { signOut } from "@/lib/api/auth";

export default function UserSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function logout() {
    await signOut();
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/user/profile"
          aria-label="返回"
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-slate-100"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
      </div>

      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center justify-between px-5 py-4 text-sm font-medium text-danger transition-colors active:bg-slate-50"
        >
          退出登录
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </Card>
    </div>
  );
}