"use client";

import {
  AccountBookOutlined,
  ApartmentOutlined,
  AuditOutlined,
  CalendarOutlined,
  DashboardOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LineChartOutlined,
  LogoutOutlined,
  ProfileOutlined,
  StarOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Typography } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthGuard } from "@/components/auth-guard";
import { Logo } from "@/components/logo";
import { clearCachedProfile } from "@/lib/api/profile-cache";
import { signOut } from "@/lib/api/auth";
import { useCurrentProfile } from "@/lib/api/hooks";

const { Sider, Content } = Layout;
const { Text } = Typography;

const NAV_ITEMS = [
  { href: "/admin", label: "控制台", icon: <DashboardOutlined /> },
  { href: "/admin/members", label: "成员管理", icon: <TeamOutlined /> },
  { href: "/admin/anchors", label: "主播管理", icon: <UserOutlined /> },
  { href: "/admin/hosts", label: "主持管理", icon: <IdcardOutlined /> },
  { href: "/admin/teams", label: "团队管理", icon: <ApartmentOutlined /> },
  { href: "/admin/team-points", label: "绩效点管理", icon: <StarOutlined /> },
  { href: "/admin/positions", label: "职位管理", icon: <IdcardOutlined /> },
  { href: "/admin/schemes", label: "工资方案", icon: <FileTextOutlined /> },
  { href: "/admin/settlement", label: "系统结算周期", icon: <CalendarOutlined /> },
  { href: "/admin/anchor-revenue", label: "主播流水", icon: <LineChartOutlined /> },
  { href: "/admin/host-revenue", label: "主持流水", icon: <LineChartOutlined /> },
  { href: "/admin/team-review", label: "流水记录", icon: <ProfileOutlined /> },
  { href: "/admin/change-requests", label: "资料审核", icon: <AuditOutlined /> },
  { href: "/admin/payroll", label: "工资核算", icon: <AccountBookOutlined /> },
];

/** 取最长匹配前缀，保证 /admin/teams/detail/* 仍高亮「团队管理」而不是「控制台」。 */
function resolveSelectedKey(pathname: string): string {
  const matched = NAV_ITEMS.map((item) => item.href)
    .filter((href) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href)))
    .sort((a, b) => b.length - a.length)[0];
  return matched ?? "/admin";
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useCurrentProfile();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey = useMemo(() => resolveSelectedKey(pathname), [pathname]);

  async function logout() {
    await signOut();
    queryClient.clear();
    clearCachedProfile();
    router.replace("/login");
  }

  const operatorName = profile.data?.name ?? "管理员";

  return (
    <AuthGuard role="admin">
      <Layout style={{ minHeight: "100dvh" }}>
        <Sider
          theme="light"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={232}
          collapsedWidth={64}
          breakpoint="lg"
          style={{
            position: "sticky",
            top: 0,
            height: "100dvh",
            borderInlineEnd: "1px solid #f0f0f0",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Link
              href="/admin"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: 10,
                padding: collapsed ? "16px 8px" : "16px",
                overflow: "hidden",
              }}
            >
              <Logo size={36} rounded="rounded-lg" alt="" />
              {collapsed ? null : (
                <span style={{ minWidth: 0, whiteSpace: "nowrap" }}>
                  <Text
                    style={{
                      display: "block",
                      fontSize: 11,
                      letterSpacing: 1,
                      color: "#1677ff",
                      fontWeight: 500,
                    }}
                  >
                    MY SALARY
                  </Text>
                  <Text strong style={{ display: "block", fontSize: 13 }}>
                    薪资核算 · 管理端
                  </Text>
                </span>
              )}
            </Link>

            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={NAV_ITEMS.map((item) => ({
                key: item.href,
                icon: item.icon,
                // label 用 <Link> 渲染真实 href，保留中键 / 右键新标签页打开；
                // onClick 仍保留，键盘（Enter / 方向键）导航才不会失效。
                label: <Link href={item.href}>{item.label}</Link>,
              }))}
              onClick={({ key }) => router.push(key)}
              style={{ flex: 1, minHeight: 0, overflowY: "auto", borderInlineEnd: "none" }}
            />

            <div style={{ borderTop: "1px solid #f0f0f0", padding: 8 }}>
              <Button
                type="text"
                block
                icon={<LogoutOutlined />}
                onClick={logout}
                title={`${operatorName} · 退出登录`}
                style={{
                  height: "auto",
                  padding: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  textAlign: "left",
                }}
              >
                {collapsed ? null : (
                  <span style={{ minWidth: 0, overflow: "hidden" }}>
                    <Text
                      strong
                      style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {operatorName}
                    </Text>
                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                      退出登录
                    </Text>
                  </span>
                )}
              </Button>
            </div>
          </div>
        </Sider>

        <Layout style={{ minWidth: 0 }}>
          <Content style={{ padding: 24, minWidth: 0 }}>{children}</Content>
        </Layout>
      </Layout>
    </AuthGuard>
  );
}
