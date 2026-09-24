import type { ReactNode } from "react";
import "../heroui.css";

/**
 * (user) 路由组布局：只负责引入 HeroUI 样式。
 * 业务外壳（AuthGuard / 底部 tab 栏）在 app/(user)/user/layout.tsx。
 */
export default function UserGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
