"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addTeamMembers,
  addTeamPerformancePoint,
  createMember,
  createPerformancePoint,
  createPosition,
  createScheme,
  createTeam,
  createTeamPerformanceRecords,
  deletePerformancePoint,
  deleteTeam,
  getCurrentProfile,
  listMembers,
  listMyChangeRequests,
  listPendingChangeRequests,
  listPerformancePoints,
  listTeamPerformance,
  listPositions,
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
  updatePosition,
  updateTeam,
  listAnchorRevenuePerf,
  getAnchorSettlementContexts,
  settleAnchorRevenue,
  listHostSchemes,
  createHostScheme,
  listHostSalaryRecords,
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
  listAnchorMembers,
  listAnchorDelays,
  setAnchorDelays,
} from "./data";
import type { Member, AnchorSettleMember, HostSettleMember, StaffSalaryCreateItem } from "./data";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { readCachedProfile, writeCachedProfile } from "./profile-cache";

export const keys = {
  profile: ["profile"] as const,
  members: ["members"] as const,
  positions: ["positions"] as const,
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
  hostSettlementContexts: ["hostSettlementContexts"] as const,
  hostSalaryStatusLogs: ["hostSalaryStatusLogs"] as const,
  staffSalary: ["staffSalary"] as const,
  staffSalaryStatusLogs: ["staffSalaryStatusLogs"] as const,
  anchorMembers: ["anchorMembers"] as const,
  anchorDelays: ["anchorDelays"] as const,
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

/** 职位增删改后，连带刷新所有内嵌/依赖职位名称或清单的查询，避免各页显示陈旧职位。 */
function invalidatePositionQueries(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.positions }),
    client.invalidateQueries({ queryKey: keys.members }),
    client.invalidateQueries({ queryKey: keys.schemes }),
    client.invalidateQueries({ queryKey: keys.salary }),
    client.invalidateQueries({ queryKey: keys.hostSchemes }),
    client.invalidateQueries({ queryKey: keys.hostSalary }),
    client.invalidateQueries({ queryKey: keys.staffSalary }),
    invalidateSettlementQueries(client),
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
export function usePositions() { return useQuery({ queryKey: keys.positions, queryFn: listPositions }); }
export function useCreatePosition() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createPosition, onSuccess: () => invalidatePositionQueries(client) });
}
export function useUpdatePosition() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: number; code?: string; name?: string }) => updatePosition(id, input), onSuccess: () => invalidatePositionQueries(client) });
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
    mutationFn: ({ profileId, positionCode, baseIncomeInCents }: { profileId: string; positionCode: string; baseIncomeInCents: number }) =>
      setStaffBaseIncome({ profileId, positionCode, baseIncomeInCents }),
    onSuccess: () => invalidateRelatedQueries(client, keys.members),
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

