"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTeamMembers,
  createMember,
  createScheme,
  createTeam,
  deleteTeam,
  getCurrentProfile,
  listMembers,
  listMyChangeRequests,
  listPendingChangeRequests,
  listPerformance,
  listPositions,
  listSalaryRecords,
  listSchemes,
  listTeams,
  removeTeamMember,
  reviewProfileChanges,
  setMemberStatus,
  submitProfileChanges,
  submitPasswordChange,
  updateMember,
  updatePerformanceStatus,
  updateSalaryStatus,
  updateTeam,
} from "./data";

export const keys = {
  profile: ["profile"] as const,
  members: ["members"] as const,
  positions: ["positions"] as const,
  performance: ["performance"] as const,
  schemes: ["schemes"] as const,
  salary: ["salary"] as const,
  teams: ["teams"] as const,
  changeRequests: ["changeRequests"] as const,
};
export function useCurrentProfile() { return useQuery({ queryKey: keys.profile, queryFn: getCurrentProfile }); }
export function useMembers() { return useQuery({ queryKey: keys.members, queryFn: listMembers }); }
export function usePositions() { return useQuery({ queryKey: keys.positions, queryFn: listPositions }); }
export function usePerformance() { return useQuery({ queryKey: keys.performance, queryFn: listPerformance }); }
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