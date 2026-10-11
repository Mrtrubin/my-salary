"use client";

import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile } from "@/lib/api/hooks";
import { hasHostRole, useMyRoleCodes } from "../payslips/roles";
import { AnchorDashboard } from "./AnchorDashboard";
import { HostDashboard } from "./HostDashboard";

/**
 * 概览页：只做角色分发。
 *
 * 主播、主持是两套完全不同的薪资概念，各自独立组件、独立数据源；
 * 本页只负责「按角色选组件」，不含任何角色实现、查询或渲染逻辑。
 * 角色判定统一取 `../payslips/roles`，不在本页硬编码角色 code。
 *
 * 固定薪资员工首页（StaffDashboard）本轮未做，见 `docs/主播端首页改造计划.md` 第十一节遗留待办；
 * 该角色目前仍落到主播分支，属既有缺陷，下一轮补齐。
 */
export default function UserDashboardPage() {
  const profile = useCurrentProfile();
  const roleCodes = useMyRoleCodes();

  if (profile.isLoading) return <QueryMessage loading error={profile.error} />;
  if (profile.data && hasHostRole(roleCodes)) return <HostDashboard profile={profile.data} />;
  // 主播分支同时作为无角色兜底，保证任何情况下都有可读引导而不是空白。
  return <AnchorDashboard />;
}
