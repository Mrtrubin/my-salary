"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addTeamMembers,
  addTeamPerformancePoint,
  createMember,
  createPerformancePoint,
  createRole,
  createScheme,
  createTeam,
  createTeamPerformanceRecords,
  deletePerformancePoint,
  deleteTeam,
  deleteTeamPerformanceRecord,
  getCurrentProfile,
  listMembers,
  listMyChangeRequests,
  listPendingChangeRequests,
  listPerformancePoints,
  listTeamPerformance,
  listRoles,
  listSalaryRecords,
  listSchemes,
  listTeams,
  removeTeamMember,
  removeTeamPerformancePoint,
  replaceTeamPerformanceRecords,
  reviewProfileChanges,
  setMemberStatus,
  submitProfileChanges,
  submitPasswordChange,
  transitionSalaryStatus,
  rejectAndRecompute,
  listSalaryStatusLogs,
  confirmSalaryRecord,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  updateMember,
  updateAnchorSettings,
  updatePerformancePoint,
  updateRole,
  updateTeam,
  listAnchorRevenuePerf,
  getAnchorSettlementContexts,
  settleAnchorRevenue,
  listHostSchemes,
  createHostScheme,
  listHostSalaryRecords,
  listMyHostMonthlyOverviews,
  getHostSettlementContexts,
  settleHostPayroll,
  transitionHostSalaryStatus,
  rejectAndRecomputeHostSalary,
  listHostSalaryStatusLogs,
  listStaffSalaryRecords,
  createStaffSalaryRecords,
  transitionStaffSalaryStatus,
  rejectAndRecomputeStaffSalary,
  listStaffSalaryStatusLogs,
  setStaffBaseIncome,
  listStaffMembers,
  listStaffPerformance,
  setStaffPerformance,
  listAnchorMembers,
  listAnchorDelays,
  setAnchorDelays,
  listAnchorRewards,
  setAnchorRewards,
  updateAnchorReward,
  deleteAnchorReward,
  listAnchorAdjustments,
  setDanceAdjustments,
  listLedgerEntries,
  createLedgerEntry,
  updateLedgerEntry,
  deleteLedgerEntry,
  getLedgerSummary,
  listLedgerTags,
  createLedgerTag,
  updateLedgerTag,
  deleteLedgerTag,
  deleteSalaryRecord,
  deleteHostSalaryRecord,
  deleteStaffSalaryRecord,
} from "./data";
import type { Member, AnchorSettleMember, HostSettleMember, StaffSalaryCreateItem, LedgerEntryInput, AnchorAdjustmentSource, DanceAdjustmentItemInput, StaffPerformanceItemInput } from "./data";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { readCachedProfile, writeCachedProfile } from "./profile-cache";

export const keys = {
  profile: ["profile"] as const,
  members: ["members"] as const,
  roles: ["roles"] as const,
  teamPerformance: ["teamPerformance"] as const,
  schemes: ["schemes"] as const,
  salary: ["salary"] as const,
  teams: ["teams"] as const,
  changeRequests: ["changeRequests"] as const,
  notifications: ["notifications"] as const,
  anchorRevenuePerf: ["anchorRevenuePerf"] as const,
  anchorSettlementContexts: ["anchorSettlementContexts"] as const,
  salaryStatusLogs: ["salaryStatusLogs"] as const,
  hostSchemes: ["hostSchemes"] as const,
  hostSalary: ["hostSalary"] as const,
  myHostMonthly: ["myHostMonthly"] as const,
  hostSettlementContexts: ["hostSettlementContexts"] as const,
  hostSalaryStatusLogs: ["hostSalaryStatusLogs"] as const,
  staffSalary: ["staffSalary"] as const,
  staffSalaryStatusLogs: ["staffSalaryStatusLogs"] as const,
  staffPerformance: ["staffPerformance"] as const,
  anchorMembers: ["anchorMembers"] as const,
  anchorDelays: ["anchorDelays"] as const,
  anchorRewards: ["anchorRewards"] as const,
  anchorAdjustments: ["anchorAdjustments"] as const,
  ledgerEntries: ["ledgerEntries"] as const,
  ledgerSummary: ["ledgerSummary"] as const,
  ledgerTags: ["ledgerTags"] as const,
};
/** 成员、方案、流水或工资快照变化后，刷新跨团队试算依赖。 */
function invalidateSettlementQueries(client: QueryClient) {
  return Promise.all([
    keys.anchorRevenuePerf,
    keys.anchorSettlementContexts,
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}

function invalidateRelatedQueries(client: QueryClient, queryKey: readonly string[]) {
  return Promise.all([
    client.invalidateQueries({ queryKey }),
    invalidateSettlementQueries(client),
  ]);
}

/** 角色增删改后，连带刷新所有内嵌/依赖角色名称或清单的查询，避免各页显示陈旧角色。 */
function invalidateRoleQueries(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.roles }),
    client.invalidateQueries({ queryKey: keys.members }),
    client.invalidateQueries({ queryKey: keys.schemes }),
    client.invalidateQueries({ queryKey: keys.salary }),
    client.invalidateQueries({ queryKey: keys.hostSchemes }),
    client.invalidateQueries({ queryKey: keys.hostSalary }),
    client.invalidateQueries({ queryKey: keys.staffSalary }),
    invalidateSettlementQueries(client),
  ]);
}

/** 收支流水/标签/汇总相关查询失效。 */
function invalidateLedgerQueries(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.ledgerEntries }),
    client.invalidateQueries({ queryKey: keys.ledgerSummary }),
    client.invalidateQueries({ queryKey: keys.ledgerTags }),
  ]);
}

export function useCurrentProfile() {
  // hydration 安全：首次渲染（含 SSR）不读 localStorage，避免 server/client 不一致
  const [cached, setCached] = useState<Member | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration 安全：挂载后再读 localStorage，避免 SSR/client 首帧不一致
    setCached(readCachedProfile());
  }, []);
  return useQuery({
    queryKey: keys.profile,
    queryFn: async () => {
      const profile = await getCurrentProfile();
      writeCachedProfile(profile);
      return profile;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    initialData: cached ?? undefined,
  });
}
export function useMembers() { return useQuery({ queryKey: keys.members, queryFn: listMembers }); }
export function useRoles() { return useQuery({ queryKey: keys.roles, queryFn: listRoles }); }
export function useCreateRole() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createRole, onSuccess: () => invalidateRoleQueries(client) });
}
export function useUpdateRole() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: number; code?: string; name?: string }) => updateRole(id, input), onSuccess: () => invalidateRoleQueries(client) });
}
export function useTeamPerformance(range?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: [...keys.teamPerformance, range?.start ?? "", range?.end ?? ""],
    queryFn: () => listTeamPerformance(range),
  });
}
export function useSchemes() { return useQuery({ queryKey: keys.schemes, queryFn: listSchemes }); }
export function useSalaryRecords() { return useQuery({ queryKey: keys.salary, queryFn: listSalaryRecords }); }
export function useTeams() { return useQuery({ queryKey: keys.teams, queryFn: listTeams }); }

export function useCreateMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createMember, onSuccess: () => invalidateRelatedQueries(client, keys.members) });
}
export function useSetMemberStatus() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) => setMemberStatus(id, status), onSuccess: () => invalidateRelatedQueries(client, keys.members) });
}
export function useUpdateMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: updateMember, onSuccess: () => invalidateRelatedQueries(client, keys.members) });
}
export function useCreateTeamPerformanceRecords() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createTeamPerformanceRecords>[0]) => createTeamPerformanceRecords(input),
    onSuccess: () => {
      return invalidateRelatedQueries(client, keys.teamPerformance);
    },
  });
}
export function useReplaceTeamPerformanceRecords() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof replaceTeamPerformanceRecords>[0]) => replaceTeamPerformanceRecords(input),
    onSuccess: () => {
      return invalidateRelatedQueries(client, keys.teamPerformance);
    },
  });
}
export function useDeleteTeamPerformanceRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTeamPerformanceRecord(id),
    onSuccess: () => invalidateRelatedQueries(client, keys.teamPerformance),
  });
}
export function useUpdateAnchorSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateAnchorSettings,
    onSuccess: () => Promise.all([
      invalidateRelatedQueries(client, keys.members),
      invalidateSettlementQueries(client),
    ]),
  });
}
export function useCreateScheme() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createScheme, onSuccess: () => invalidateRelatedQueries(client, keys.schemes) });
}
export function useTransitionSalaryStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, operatorProfileId, note }: { id: string; status: import("./data").SalaryRecordStatus; operatorProfileId?: string; note?: string }) =>
      transitionSalaryStatus(id, status, { operatorProfileId, note }),
    onSuccess: () => {
      return Promise.all([
        client.invalidateQueries({ queryKey: keys.salary }),
        client.invalidateQueries({ queryKey: keys.salaryStatusLogs }),
        invalidateSettlementQueries(client),
      ]);
    },
  });
}
export function useRejectAndRecompute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, operatorProfileId }: { id: string; operatorProfileId?: string }) => rejectAndRecompute(id, { operatorProfileId }),
    onSuccess: () => {
      return Promise.all([
        client.invalidateQueries({ queryKey: keys.salary }),
        client.invalidateQueries({ queryKey: keys.salaryStatusLogs }),
        invalidateSettlementQueries(client),
      ]);
    },
  });
}
export function useSalaryStatusLogs(salaryRecordId: string | null) {
  return useQuery({
    queryKey: ["salaryStatusLogs", salaryRecordId],
    queryFn: () => listSalaryStatusLogs(salaryRecordId as string),
    enabled: !!salaryRecordId,
  });
}
export function useConfirmSalaryRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profileId }: { id: string; profileId: string }) => confirmSalaryRecord(id, profileId),
    onSuccess: () => Promise.all([
      invalidateRelatedQueries(client, keys.salary),
      client.invalidateQueries({ queryKey: keys.salaryStatusLogs }),
    ]),
  });
}
export function useNotifications(profileId: string | null) {
  return useQuery({
    queryKey: [...keys.notifications, profileId],
    queryFn: () => listNotifications(profileId as string),
    enabled: !!profileId,
  });
}
export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}
export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => markAllNotificationsRead(profileId),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}
export function useCreateTeam() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createTeam, onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}
export function useUpdateTeam() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: string; name?: string; teamCode?: string; hostProfileId?: string; status?: "active" | "disabled" }) => updateTeam(id, input), onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}
export function useDeleteTeam() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteTeam, onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}
export function useAddTeamMembers() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, anchorProfileIds }: { teamId: string; anchorProfileIds: string[] }) => addTeamMembers(teamId, anchorProfileIds), onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}
export function useRemoveTeamMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, profileId }: { teamId: string; profileId: string }) => removeTeamMember(teamId, profileId), onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}

// ==================== 绩效点类型（全局字典）====================
const performancePointsKey = ["performancePoints"] as const;

export function usePerformancePoints() {
  return useQuery({ queryKey: performancePointsKey, queryFn: listPerformancePoints });
}
export function useCreatePerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createPerformancePoint, onSuccess: () => invalidateRelatedQueries(client, performancePointsKey) });
}
export function useUpdatePerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: string; name?: string; pointsPerYuan?: number; status?: "active" | "disabled" }) => updatePerformancePoint(id, input), onSuccess: () => invalidateRelatedQueries(client, performancePointsKey) });
}
export function useDeletePerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deletePerformancePoint, onSuccess: () => invalidateRelatedQueries(client, performancePointsKey) });
}
export function useAddTeamPerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, pointId }: { teamId: string; pointId: string }) => addTeamPerformancePoint(teamId, pointId), onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}
export function useRemoveTeamPerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, pointId }: { teamId: string; pointId: string }) => removeTeamPerformancePoint(teamId, pointId), onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
}
export function useMyChangeRequests() { return useQuery({ queryKey: keys.changeRequests, queryFn: listMyChangeRequests }); }
export function usePendingChangeRequests() { return useQuery({ queryKey: keys.changeRequests, queryFn: listPendingChangeRequests }); }
export function useSubmitProfileChanges() {
  const client = useQueryClient();
  return useMutation({ mutationFn: submitProfileChanges, onSuccess: () => { client.invalidateQueries({ queryKey: keys.profile }); client.invalidateQueries({ queryKey: keys.changeRequests }); } });
}
export function useReviewProfileChanges() {
  const client = useQueryClient();
  return useMutation({ mutationFn: reviewProfileChanges, onSuccess: () => Promise.all([
    invalidateRelatedQueries(client, keys.members),
    client.invalidateQueries({ queryKey: keys.changeRequests }),
    client.invalidateQueries({ queryKey: keys.profile }),
  ]) });
}
export function useSubmitPasswordChange() {
  const client = useQueryClient();
  return useMutation({ mutationFn: submitPasswordChange, onSuccess: () => { client.invalidateQueries({ queryKey: keys.changeRequests }); } });
}

// ==================== 主播流水结算（/admin/anchor-revenue）====================

/** teamId 为空表示全部系统主播；仅周期为空时不请求。 */
export function useAnchorRevenuePerf(teamId: string | null, period: PeriodRange | null) {
  return useQuery({
    queryKey: [...keys.anchorRevenuePerf, teamId, period?.start, period?.end],
    queryFn: () => listAnchorRevenuePerf(teamId, period!.start, period!.end),
    enabled: period !== null,
  });
}

/** 团队仅用于筛选名单；上下文与金额使用系统结算口径。 */
export function useAnchorSettlementContexts(teamId: string | null, period: PeriodRange | null) {
  return useQuery({
    queryKey: [...keys.anchorSettlementContexts, teamId, period?.start, period?.end],
    queryFn: () => getAnchorSettlementContexts(teamId, period!),
    enabled: period !== null,
  });
}

/** 手动结算主播流水（勾选主播 + 调整项 → 落库进四态审核流）。 */
export function useSettleAnchorRevenue() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { teamId: string | null; period: PeriodRange; members: AnchorSettleMember[]; replaceOverlapping?: boolean }) => settleAnchorRevenue(input),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.salary }),
      client.invalidateQueries({ queryKey: keys.salaryStatusLogs }),
      invalidateSettlementQueries(client),
      invalidateLedgerQueries(client),
    ]),
  });
}
// ==================== 主持工资核算（/admin/hosts、/admin/host-revenue）====================

export function useHostSchemes() {
  return useQuery({ queryKey: keys.hostSchemes, queryFn: listHostSchemes });
}

export function useCreateHostScheme() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createHostScheme,
    onSuccess: () => invalidateRelatedQueries(client, keys.hostSchemes),
  });
}

export function useHostSalaryRecords() {
  return useQuery({ queryKey: keys.hostSalary, queryFn: listHostSalaryRecords });
}

/** 主持本人按月汇总的团总流水概览（最新月份在前）；无 hostProfileId 时不请求。 */
export function useMyHostMonthlyOverviews(hostProfileId: string | null) {
  return useQuery({
    queryKey: [...keys.myHostMonthly, hostProfileId],
    queryFn: () => listMyHostMonthlyOverviews(hostProfileId!),
    enabled: !!hostProfileId,
  });
}

/** period 为空时不请求；团总流水跨团队汇总，结算口径与系统周期一致。 */
export function useHostSettlementContexts(period: PeriodRange | null) {
  return useQuery({
    queryKey: [...keys.hostSettlementContexts, period?.start, period?.end],
    queryFn: () => getHostSettlementContexts(period!),
    enabled: period !== null,
  });
}

/** 手动结算主持工资（勾选主持 + 调整项 → 独立主持工资表四态审核流）。 */
export function useSettleHostPayroll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { period: PeriodRange; hosts: HostSettleMember[]; replaceOverlapping?: boolean }) => settleHostPayroll(input),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.hostSalary }),
      client.invalidateQueries({ queryKey: keys.hostSalaryStatusLogs }),
      client.invalidateQueries({ queryKey: keys.hostSettlementContexts }),
      invalidateLedgerQueries(client),
    ]),
  });
}

export function useTransitionHostSalaryStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, operatorProfileId, note }: { id: string; status: import("./data").SalaryRecordStatus; operatorProfileId?: string; note?: string }) =>
      transitionHostSalaryStatus(id, status, { operatorProfileId, note }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.hostSalary }),
      client.invalidateQueries({ queryKey: keys.hostSalaryStatusLogs }),
    ]),
  });
}

export function useRejectAndRecomputeHostSalary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectAndRecomputeHostSalary(id),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.hostSalary }),
      client.invalidateQueries({ queryKey: keys.hostSalaryStatusLogs }),
      client.invalidateQueries({ queryKey: keys.hostSettlementContexts }),
      invalidateLedgerQueries(client),
    ]),
  });
}

export function useHostSalaryStatusLogs(salaryRecordId: string | null) {
  return useQuery({
    queryKey: ["hostSalaryStatusLogs", salaryRecordId],
    queryFn: () => listHostSalaryStatusLogs(salaryRecordId as string),
    enabled: !!salaryRecordId,
  });
}

// ==================== 化妆师收益 + 主播延误记录 ====================

export function useStaffSalaryRecords() {
  return useQuery({ queryKey: keys.staffSalary, queryFn: listStaffSalaryRecords });
}

export function useCreateStaffSalaryRecords() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { period: PeriodRange; records: StaffSalaryCreateItem[] }) =>
      createStaffSalaryRecords(input),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.staffSalary }),
      client.invalidateQueries({ queryKey: keys.staffSalaryStatusLogs }),
      invalidateLedgerQueries(client),
    ]),
  });
}

export function useTransitionStaffSalaryStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, operatorProfileId, note }: { id: string; status: import("./data").SalaryRecordStatus; operatorProfileId?: string; note?: string }) =>
      transitionStaffSalaryStatus(id, status, { operatorProfileId, note }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.staffSalary }),
      client.invalidateQueries({ queryKey: keys.staffSalaryStatusLogs }),
      invalidateLedgerQueries(client),
    ]),
  });
}

export function useRejectAndRecomputeStaffSalary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectAndRecomputeStaffSalary(id),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.staffSalary }),
      client.invalidateQueries({ queryKey: keys.staffSalaryStatusLogs }),
      invalidateLedgerQueries(client),
    ]),
  });
}

export function useStaffSalaryStatusLogs(salaryRecordId: string | null) {
  return useQuery({
    queryKey: ["staffSalaryStatusLogs", salaryRecordId],
    queryFn: () => listStaffSalaryStatusLogs(salaryRecordId as string),
    enabled: !!salaryRecordId,
  });
}

export function useSetStaffBaseIncome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, roleCode, baseIncomeInCents }: { profileId: string; roleCode: string; baseIncomeInCents: number }) =>
      setStaffBaseIncome({ profileId, roleCode, baseIncomeInCents }),
    onSuccess: () => {
      invalidateRelatedQueries(client, keys.members);
      client.invalidateQueries({ queryKey: keys.staffPerformance });
    },
  });
}

/** 某角色的在职成员（含当前基础薪资）。 */
export function useStaffMembers(roleCode: string) {
  return useQuery({
    queryKey: [...keys.staffPerformance, "members", roleCode],
    queryFn: () => listStaffMembers(roleCode),
  });
}

/** 人事绩效；range 为空返回全部（页面自行取最新日期）。 */
export function useStaffPerformance(roleCode: string, range?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: [...keys.staffPerformance, roleCode, range?.start ?? "", range?.end ?? ""],
    queryFn: () => listStaffPerformance({ roleCode, range }),
  });
}

export function useSetStaffPerformance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roleCode: string;
      date: string;
      entries: { profileId: string; items: StaffPerformanceItemInput[] }[];
      registeredBy?: string;
    }) => setStaffPerformance(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.staffPerformance }),
  });
}

export function useAnchorMembers() {
  return useQuery({ queryKey: keys.anchorMembers, queryFn: listAnchorMembers });
}

/** range 为空返回全部延误记录（页面自行取最新日期）。 */
export function useAnchorDelays(range?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: [...keys.anchorDelays, range?.start ?? "", range?.end ?? ""],
    queryFn: () => listAnchorDelays(range),
  });
}

export function useSetAnchorDelays() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; anchorIds: string[]; isDelayed: boolean; note?: string }) =>
      setAnchorDelays(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.anchorDelays }),
  });
}

/** range 为空返回全部奖励记录（页面自行取最新日期）。 */
export function useAnchorRewards(range?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: [...keys.anchorRewards, range?.start ?? "", range?.end ?? ""],
    queryFn: () => listAnchorRewards(range),
  });
}

export function useSetAnchorRewards() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; anchorIds: string[]; name: string; amountCents: number; note?: string }) =>
      setAnchorRewards(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.anchorRewards }),
  });
}

export function useUpdateAnchorReward() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string; amountCents: number; note?: string }) =>
      updateAnchorReward(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.anchorRewards }),
  });
}

export function useDeleteAnchorReward() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAnchorReward(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.anchorRewards }),
  });
}

/** 统一调整项（主播）：range 为空返回全部（页面自行取最新日期）。 */
export function useAnchorAdjustments(source?: AnchorAdjustmentSource, range?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: [...keys.anchorAdjustments, source ?? "", range?.start ?? "", range?.end ?? ""],
    queryFn: () => listAnchorAdjustments({ source, range }),
  });
}

export function useSetDanceAdjustments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; entries: { anchorId: string; items: DanceAdjustmentItemInput[] }[]; registeredBy?: string }) =>
      setDanceAdjustments(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.anchorAdjustments }),
  });
}

// ==================== 收支明细 ====================

export function useLedgerEntries(range?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: [...keys.ledgerEntries, range?.start ?? "", range?.end ?? ""],
    queryFn: () => listLedgerEntries(range),
  });
}

/** range 为空时不请求。 */
export function useLedgerSummary(range: { start: string; end: string } | null) {
  return useQuery({
    queryKey: [...keys.ledgerSummary, range?.start ?? "", range?.end ?? ""],
    queryFn: () => getLedgerSummary(range!.start, range!.end),
    enabled: range !== null,
  });
}

export function useLedgerTags() {
  return useQuery({ queryKey: keys.ledgerTags, queryFn: listLedgerTags });
}

export function useCreateLedgerEntry() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createLedgerEntry, onSuccess: () => invalidateLedgerQueries(client) });
}

export function useUpdateLedgerEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<LedgerEntryInput>) => updateLedgerEntry(id, input),
    onSuccess: () => invalidateLedgerQueries(client),
  });
}

export function useDeleteLedgerEntry() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteLedgerEntry, onSuccess: () => invalidateLedgerQueries(client) });
}

export function useCreateLedgerTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createLedgerTag, onSuccess: () => invalidateLedgerQueries(client) });
}

export function useUpdateLedgerTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; status?: "active" | "disabled" }) => updateLedgerTag(id, input),
    onSuccess: () => invalidateLedgerQueries(client),
  });
}

export function useDeleteLedgerTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteLedgerTag, onSuccess: () => invalidateLedgerQueries(client) });
}

/** 删除未完成工资条（主播/主持/员工），并刷新工资条与收支流水。 */
export function useDeleteSalaryRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "anchor" | "host" | "staff" }) => {
      if (kind === "host") return deleteHostSalaryRecord(id);
      if (kind === "staff") return deleteStaffSalaryRecord(id);
      return deleteSalaryRecord(id);
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.salary }),
      client.invalidateQueries({ queryKey: keys.hostSalary }),
      client.invalidateQueries({ queryKey: keys.staffSalary }),
      invalidateLedgerQueries(client),
    ]),
  });
}

