import type { NextConfig } from "next";

/**
 * 静态导出配置。
 * - output: 'export' 生成纯静态站点(out/ 目录)。
 * - trailingSlash: true 让每个路由导出为 `路由/index.html`,
 *   这样静态服务器/对象存储在直接访问或刷新子路由(如 /admin/review/)时
 *   能正确命中 index.html,避免 404。
 * - basePath: 部署到非根路径(如 https://host/my-salary)时,
 *   通过环境变量 NEXT_PUBLIC_BASE_PATH 注入,例如设为 "/my-salary"。
 *   默认为空表示部署在根路径。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: { unoptimized: true },
};

export default nextConfig;