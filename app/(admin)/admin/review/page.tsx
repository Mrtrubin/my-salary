import { redirect } from "next/navigation";

/**
 * 旧路由 /admin/review 已重命名为 /admin/anchor-revenue（主播流水）。
 * 保留此重定向以兼容历史书签/外部链接。
 */
export default function LegacyReviewRedirect() {
  redirect("/admin/anchor-revenue");
}