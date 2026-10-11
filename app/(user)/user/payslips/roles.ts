"use client";

/**
 * 用户端工资条的「角色概念」判定。
 *
 * 工资条按业务概念分三块，各自独立组件、互不依赖：
 *  - 主播：保底/提成互斥模式（`AnchorPayslipList`）
 *  - 主持：按团总流水整体计提（`HostPayslipList`）
 *  - 固定薪资员工：化妆师/舞蹈/行政/运镜/人事（`StaffPayslipList`）
 *
 * 本模块集中维护角色 code，避免每个组件各自硬编码判断。
 */
import { useMemo } from "react";
import { useCurrentProfile } from "@/lib/api/hooks";

export const ANCHOR_ROLE_CODE = "anchor";
export const HOST_ROLE_CODE = "host";

/**
 * 固定薪资类角色 code。
 * 与 `supabase/migrations` 中 `positions` / `roles` 的种子保持一致；
 * 新增固定薪资职位时需同步追加，否则该角色的工资条区块不会展示。
 */
export const STAFF_ROLE_CODES = [
  "dance",
  "makeup",
  "executive",
  "camera",
  "hr",
  "hr_manager",
] as const;

/** 当前登录用户持有的角色 code 集合。 */
export function useMyRoleCodes(): ReadonlySet<string> {
  const profile = useCurrentProfile();
  return useMemo(
    () =>
      new Set(
        (profile.data?.user_roles ?? []).flatMap(({ role }) => (role?.code ? [role.code] : [])),
      ),
    [profile.data],
  );
}

/** 是否持有固定薪资类角色之一。 */
export function hasStaffRole(roleCodes: ReadonlySet<string>): boolean {
  return STAFF_ROLE_CODES.some((code) => roleCodes.has(code));
}
