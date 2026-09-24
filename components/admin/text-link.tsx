"use client";

import { theme } from "antd";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * admin 端的文本链接（表格单元格、正文中可跳转的文字）。
 *
 * 为什么不用 antd 的 <Typography.Link>：
 * 它渲染 <a>，而 Next 的 <Link> 也渲染 <a>，两者嵌套会得到 <a> 套 <a>，
 * 触发 React 的 hydration 报错：In HTML, <a> cannot be a descendant of <a>。
 *
 * 这里让 Next <Link> 独占 <a>：
 * - 保留真实 href ⇒ 可中键 / 右键新标签页打开，也支持 Next 的客户端路由与预取；
 * - 配色取自 antd 主题 token（经 CSS 自定义属性传给 app/admin.css 里的规则），
 *   因此外观仍与 antd 的链接一致，且不会写死色值。
 *
 * 注意：不要用 Tailwind 工具类给它上色 —— antd 的样式是无层级的，
 * 会压掉 Tailwind 的 @layer utilities，见 app/globals.css 顶部说明。
 */
export function TextLink({
  href,
  children,
  title,
}: {
  href: string;
  children: ReactNode;
  title?: string;
}) {
  const { token } = theme.useToken();

  return (
    <Link
      href={href}
      title={title}
      className="admin-text-link"
      style={
        {
          "--admin-text-link-color": token.colorLink,
          "--admin-text-link-hover-color": token.colorLinkHover,
        } as CSSProperties
      }
    >
      {children}
    </Link>
  );
}
