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
  getTeamEarliestPerfDate,
  settleAnchorRevenue,
  getSystemSettlementSettings,
  updateSystemSettlementSettings,
} from "./data";
import type { Member, AnchorSettleMember } from "./data";
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
  systemSettlementSettings: ["systemSettlementSettings"] as const,
  teamEarliestPerfDate: ["teamEarliestPerfDate"] as const,
  salaryStatusLogs: ["salaryStatusLogs"] as const,
};

/** 成员、方案、流水或工资快照变化后，刷新跨团队试算依赖。 */
function invalidateSettlementQueries(client: QueryClient) {
  return Promise.all([
    keys.anchorRevenuePerf,
    keys.anchorSettlementContexts,
    keys.teamEarliestPerfDate,
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}

function invalidateRelatedQueries(client: QueryClient, queryKey: readonly string[]) {
  return Promise.all([
    client.invalidateQueries({ queryKey }),
    invalidateSettlementQueries(client),
  ]);
}

export function useSystemSettlementSettings() {
  return useQuery({ queryKey: keys.systemSettlementSettings, queryFn: getSystemSettlementSettings });
}

export function useUpdateSystemSettlementSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateSystemSettlementSettings,
    onSuccess: () => Promise.all([
      ...[keys.systemSettlementSettings, keys.teams, keys.salary, keys.teamPerformance, keys.salaryStatusLogs]
        .map((queryKey) => client.invalidateQueries({ queryKey })),
      invalidateSettlementQueries(client),
    ]),
  });
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
  return useMutation({ mutationFn: createPosition, onSuccess: () => invalidateRelatedQueries(client, keys.positions) });
}
export function useUpdatePosition() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: number; code?: string; name?: string }) => updatePosition(id, input), onSuccess: () => invalidateRelatedQueries(client, keys.positions) });
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
  return useMutation({ mutationFn: ({ id, ...input }: { id: string; name?: string; hostProfileId?: string; status?: "active" | "disabled" }) => updateTeam(id, input), onSuccess: () => invalidateRelatedQueries(client, keys.teams) });
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

/** teamId 为空时查询系统最早流水日期。 */
export function useTeamEarliestPerfDate(teamId: string | null) {
  return useQuery({
    queryKey: [...keys.teamEarliestPerfDate, teamId],
    queryFn: () => getTeamEarliestPerfDate(teamId),
  });
}


/** 手动结算主播流水（勾选主播 + 调整项 → 落库进四态审核流）。 */
export function useSettleAnchorRevenue() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { teamId: string | null; period: PeriodRange; members: AnchorSettleMember[] }) => settleAnchorRevenue(input),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: keys.salary }),
      client.invalidateQueries({ queryKey: keys.salaryStatusLogs }),
      invalidateSettlementQueries(client),
    ]),
  });
}