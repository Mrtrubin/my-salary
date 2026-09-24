import type { ReactNode } from "react";
import "../heroui.css";

/**
 * (auth) 路由组布局：只负责引入 HeroUI 样式。
 * 登录/注册页用 components/ui/* 里的 HeroUI 组件，因此必须有这套样式。
 */
export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
