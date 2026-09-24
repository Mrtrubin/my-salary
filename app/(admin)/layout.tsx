import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { ReactNode } from "react";
import "../admin.css";
import { AdminAntdProvider } from "@/components/admin/antd-provider";

/**
 * admin 路由组的 antd 边界。
 *
 * AntdRegistry 把首屏 antd 样式在服务端注入 HTML，避免进入后台时样式闪动；
 * 放在路由组而非根 layout，是为了让 antd 的样式只在 admin 路由加载，
 * user 端（HeroUI）完全不受影响。
 *
 * 同理，admin 专属的补充样式走 ../admin.css，不进全局 globals.css。
 */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <AdminAntdProvider>{children}</AdminAntdProvider>
    </AntdRegistry>
  );
}
