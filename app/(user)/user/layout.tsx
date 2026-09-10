"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { NotificationBell } from "@/components/notification-bell";

type Tab = { href: string; label: string; icon: ReactNode };

const TABS: Tab[] = [
  { href: "/user/dashboard", label: "概览", icon: <IconHome /> },
  { href: "/user/performance", label: "业绩", icon: <IconChart /> },
  { href: "/user/payslips", label: "工资条", icon: <IconWallet /> },
  { href: "/user/profile", label: "我的", icon: <IconUser /> },
];

export default function UserLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // 仅在主 tab 页显示底部导航栏；二级页面（如设置）隐藏
  const showTabBar = TABS.some((tab) => pathname.startsWith(tab.href));

  return (
    <AuthGuard role="user">
      {/* 桌面下居中呈现「手机」画布，两侧留白 */}
      <div className="min-h-screen bg-slate-100">
        <div className="relative mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-slate-50 shadow-xl shadow-slate-300/40">
          {/* 内容区：底部预留导航栏（仅当显示 tab 栏时） + 安全区高度 */}
          <main
            className={`flex-1 px-4 pt-[calc(20px+env(safe-area-inset-top))] ${
              showTabBar ? "pb-[calc(72px+env(safe-area-inset-bottom))]" : "pb-[calc(20px+env(safe-area-inset-bottom))]"
            }`}
          >
            <div className="mb-2 flex items-center justify-end">
              <NotificationBell />
            </div>
            {children}
          </main>

          {/* 底部 tab 栏：更大的点击区域 + 安全区适配 */}
          {showTabBar ? (
            <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 border-t border-slate-200/70 bg-white/90 backdrop-blur-md">
              <div className="grid grid-cols-4">
                {TABS.map((tab) => {
                  const active = pathname.startsWith(tab.href);
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      className={`flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] transition-colors ${
                        active ? "font-medium text-indigo-600" : "text-slate-400"
                      }`}
                    >
                      <span className={`flex h-6 w-6 items-center justify-center ${active ? "" : "opacity-80"}`}>
                        {tab.icon}
                      </span>
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
              <div className="pb-[env(safe-area-inset-bottom)]" />
            </nav>
          ) : null}
        </div>
      </div>
    </AuthGuard>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconHome() {
  return <IconBase><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></IconBase>;
}
function IconChart() {
  return <IconBase><path d="M4 20V4" /><path d="M4 20h16" /><rect x="8" y="11" width="3" height="6" /><rect x="14" y="7" width="3" height="10" /></IconBase>;
}
function IconWallet() {
  return <IconBase><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><circle cx="17" cy="14" r="1" /></IconBase>;
}
function IconUser() {
  return <IconBase><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></IconBase>;
}