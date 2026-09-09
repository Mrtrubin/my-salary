"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTeamMembers,
  addTeamPerformancePoint,
  createMember,
  createPerformancePoint,
  createPerformanceRecords,
  createScheme,
  createTeam,
  createTeamPerformanceRecords,
  deletePerformancePoint,
  deleteTeam,
  getCurrentProfile,
  listMembers,
  listMyChangeRequests,
  listPendingChangeRequests,
  listPerformance,
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
  updateMember,
  updatePerformancePoint,
  updatePerformanceStatus,
  updateSalaryStatus,
  updateTeamPerformanceStatus,
  updateTeam,
} from "./data";

export const keys = {
  profile: ["profile"] as const,
  members: ["members"] as const,
  positions: ["positions"] as const,
  performance: ["performance"] as const,
  teamPerformance: ["teamPerformance"] as const,
  schemes: ["schemes"] as const,
  salary: ["salary"] as const,
  teams: ["teams"] as const,
  changeRequests: ["changeRequests"] as const,
};
export function useCurrentProfile() { return useQuery({ queryKey: keys.profile, queryFn: getCurrentProfile }); }
export function useMembers() { return useQuery({ queryKey: keys.members, queryFn: listMembers }); }
export function usePositions() { return useQuery({ queryKey: keys.positions, queryFn: listPositions }); }
export function usePerformance() { return useQuery({ queryKey: keys.performance, queryFn: listPerformance }); }
export function useTeamPerformance() { return useQuery({ queryKey: keys.teamPerformance, queryFn: listTeamPerformance }); }
export function useSchemes() { return useQuery({ queryKey: keys.schemes, queryFn: listSchemes }); }
export function useSalaryRecords() { return useQuery({ queryKey: keys.salary, queryFn: listSalaryRecords }); }
export function useTeams() { return useQuery({ queryKey: keys.teams, queryFn: listTeams }); }

export function useCreateMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createMember, onSuccess: () => client.invalidateQueries({ queryKey: keys.members }) });
}
export function useSetMemberStatus() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) => setMemberStatus(id, status), onSuccess: () => client.invalidateQueries({ queryKey: keys.members }) });
}
export function useUpdateMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: updateMember, onSuccess: () => client.invalidateQueries({ queryKey: keys.members }) });
}
export function useUpdatePerformanceStatus() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, status, reason }: { id: string; status: "approved" | "rejected"; reason?: string }) => updatePerformanceStatus(id, status, reason), onSuccess: () => client.invalidateQueries({ queryKey: keys.performance }) });
}
export function useUpdateTeamPerformanceStatus() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, status, reason }: { id: string; status: "approved" | "rejected"; reason?: string }) => updateTeamPerformanceStatus(id, status, reason), onSuccess: () => client.invalidateQueries({ queryKey: keys.teamPerformance }) });
}
export function useCreatePerformanceRecords() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ hostProfileId, items }: { hostProfileId: string; items: import("./data").PerformanceUploadItem[] }) => createPerformanceRecords(hostProfileId, items),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.performance }),
  });
}
export function useCreateTeamPerformanceRecords() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createTeamPerformanceRecords>[0]) => createTeamPerformanceRecords(input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.performance });
      client.invalidateQueries({ queryKey: keys.teamPerformance });
    },
  });
}
export function useReplaceTeamPerformanceRecords() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof replaceTeamPerformanceRecords>[0]) => replaceTeamPerformanceRecords(input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.performance });
      client.invalidateQueries({ queryKey: keys.teamPerformance });
    },
  });
}
export function useCreateScheme() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createScheme, onSuccess: () => client.invalidateQueries({ queryKey: keys.schemes }) });
}
export function useUpdateSalaryStatus() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: "confirmed" | "published" | "voided" }) => updateSalaryStatus(id, status), onSuccess: () => client.invalidateQueries({ queryKey: keys.salary }) });
}
export function useCreateTeam() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createTeam, onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}
export function useUpdateTeam() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: string; name?: string; hostProfileId?: string; status?: "active" | "disabled" }) => updateTeam(id, input), onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}
export function useDeleteTeam() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteTeam, onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}
export function useAddTeamMembers() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, anchorProfileIds }: { teamId: string; anchorProfileIds: string[] }) => addTeamMembers(teamId, anchorProfileIds), onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}
export function useRemoveTeamMember() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, profileId }: { teamId: string; profileId: string }) => removeTeamMember(teamId, profileId), onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}

// ==================== 绩效点类型（全局字典）====================
const performancePointsKey = ["performancePoints"] as const;

export function usePerformancePoints() {
  return useQuery({ queryKey: performancePointsKey, queryFn: listPerformancePoints });
}
export function useCreatePerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createPerformancePoint, onSuccess: () => client.invalidateQueries({ queryKey: performancePointsKey }) });
}
export function useUpdatePerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: { id: string; name?: string; pointsPerYuan?: number; status?: "active" | "disabled" }) => updatePerformancePoint(id, input), onSuccess: () => client.invalidateQueries({ queryKey: performancePointsKey }) });
}
export function useDeletePerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deletePerformancePoint, onSuccess: () => client.invalidateQueries({ queryKey: performancePointsKey }) });
}
export function useAddTeamPerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, pointId }: { teamId: string; pointId: string }) => addTeamPerformancePoint(teamId, pointId), onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}
export function useRemoveTeamPerformancePoint() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ teamId, pointId }: { teamId: string; pointId: string }) => removeTeamPerformancePoint(teamId, pointId), onSuccess: () => client.invalidateQueries({ queryKey: keys.teams }) });
}
export function useMyChangeRequests() { return useQuery({ queryKey: keys.changeRequests, queryFn: listMyChangeRequests }); }
export function usePendingChangeRequests() { return useQuery({ queryKey: keys.changeRequests, queryFn: listPendingChangeRequests }); }
export function useSubmitProfileChanges() {
  const client = useQueryClient();
  return useMutation({ mutationFn: submitProfileChanges, onSuccess: () => { client.invalidateQueries({ queryKey: keys.profile }); client.invalidateQueries({ queryKey: keys.changeRequests }); } });
}
export function useReviewProfileChanges() {
  const client = useQueryClient();
  return useMutation({ mutationFn: reviewProfileChanges, onSuccess: () => { client.invalidateQueries({ queryKey: keys.members }); client.invalidateQueries({ queryKey: keys.changeRequests }); } });
}
export function useSubmitPasswordChange() {
  const client = useQueryClient();
  return useMutation({ mutationFn: submitPasswordChange, onSuccess: () => { client.invalidateQueries({ queryKey: keys.changeRequests }); } });
}