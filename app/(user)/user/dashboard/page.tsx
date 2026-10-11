"use client";

import { useMemo } from "react";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile } from "@/lib/api/hooks";
import { AnchorDashboard } from "./AnchorDashboard";
import { HostDashboard } from "./HostDashboard";

/**
 * 概览页：只做角色分发。
 *
 * 主播与主持是两套完全不同的薪资概念，各自独立组件、独立数据源；
 * 本页只负责「按角色选组件」，不含任何角色实现、查询或渲染逻辑。
 */
export default function UserDashboardPage() {
  const profile = useCurrentProfile();
  const isHost = useMemo(
    () => profile.data?.user_roles?.some(({ role }) => role?.code === "host") ?? false,
    [profile.data],
  );

  if (profile.isLoading) return <QueryMessage loading error={profile.error} />;
  if (profile.data && isHost) return <HostDashboard profile={profile.data} />;
  return <AnchorDashboard />;
}
