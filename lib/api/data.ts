import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type PerformanceStatus = Database["public"]["Enums"]["performance_status"];
export type SalaryRecordStatus = Database["public"]["Enums"]["salary_record_status"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Position = Database["public"]["Tables"]["positions"]["Row"];
export type PerformanceRecord = Database["public"]["Tables"]["performance_records"]["Row"] & { profile: Pick<Profile, "name"> | null; host: Pick<Profile, "name"> | null };
export type SalaryScheme = Database["public"]["Tables"]["salary_schemes"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "name"> | null };
export type SalaryRecord = Database["public"]["Tables"]["salary_records"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "name"> | null };
export type Employee = Profile & { user_positions: { position: Position | null }[] };

function fail(error: { message: string; code?: string } | null): never {
  throw new ApiError(error?.code === "42501" ? ApiErrorCode.FORBIDDEN : ApiErrorCode.UNKNOWN, error?.message ?? "数据请求失败", error);
}

export async function getCurrentProfile(): Promise<Employee | null> {
  const supabase = getBrowserSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("profiles").select("*, user_positions(position:positions(*))").eq("auth_user_id", auth.user.id).maybeSingle();
  if (error) fail(error);
  return data as Employee | null;
}

export async function listEmployees(): Promise<Employee[]> {
  const { data, error } = await getBrowserSupabase().from("profiles").select("*, user_positions(position:positions(*))").order("name");
  if (error) fail(error);
  return data as Employee[];
}

export async function createEmployee(input: { name: string; phone: string; hireDate: string; positionIds: number[] }) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("profiles").insert({ name: input.name, phone: input.phone, hire_date: input.hireDate }).select().single();
  if (error) fail(error);
  if (input.positionIds.length) {
    const { error: positionError } = await supabase.from("user_positions").insert(input.positionIds.map((positionId) => ({ profile_id: data.id, position_id: positionId })));
    if (positionError) fail(positionError);
  }
  return data;
}

export async function setEmployeeStatus(id: string, status: "active" | "disabled") {
  const { error } = await getBrowserSupabase().from("profiles").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail(error);
}

export async function listPositions(): Promise<Position[]> {
  const { data, error } = await getBrowserSupabase().from("positions").select("*").order("id");
  if (error) fail(error);
  return data;
}

export async function listPerformance(): Promise<PerformanceRecord[]> {
  const { data, error } = await getBrowserSupabase().from("performance_records").select("*, profile:profiles!performance_records_profile_id_fkey(name), host:profiles!performance_records_host_profile_id_fkey(name)").order("month", { ascending: false });
  if (error) fail(error);
  return data as unknown as PerformanceRecord[];
}

export async function updatePerformanceStatus(id: string, status: PerformanceStatus, rejectReason?: string) {
  const { error } = await getBrowserSupabase().from("performance_records").update({ status, reject_reason: rejectReason ?? null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail(error);
}

export async function listSchemes(): Promise<SalaryScheme[]> {
  const { data, error } = await getBrowserSupabase().from("salary_schemes").select("*, profile:profiles(name), position:positions(name)").order("created_at", { ascending: false });
  if (error) fail(error);
  return data as unknown as SalaryScheme[];
}

export async function createScheme(input: Database["public"]["Tables"]["salary_schemes"]["Insert"]) {
  const { error } = await getBrowserSupabase().from("salary_schemes").insert(input);
  if (error) fail(error);
}

export async function listSalaryRecords(): Promise<SalaryRecord[]> {
  const { data, error } = await getBrowserSupabase().from("salary_records").select("*, profile:profiles(name), position:positions(name)").order("month", { ascending: false });
  if (error) fail(error);
  return data as unknown as SalaryRecord[];
}

export async function updateSalaryStatus(id: string, status: SalaryRecordStatus) {
  const { error } = await getBrowserSupabase().from("salary_records").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail(error);
}

export type Team = Database["public"]["Tables"]["teams"]["Row"] & { host: Pick<Profile, "id" | "name"> | null; members: { profile: Pick<Profile, "id" | "name"> | null }[] };

export async function listTeams(): Promise<Team[]> {
  const { data, error } = await getBrowserSupabase()
    .from("teams")
    .select("*, host:profiles!teams_host_profile_id_fkey(id, name), members:team_members(profile:profiles(id,name))")
    .order("name");
  if (error) fail(error);
  return data as unknown as Team[];
}

export async function createTeam(input: { name: string; hostProfileId: string; anchorProfileIds?: string[] }) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("teams").insert({ name: input.name, host_profile_id: input.hostProfileId }).select().single();
  if (error) fail(error);
  if (input.anchorProfileIds?.length) {
    const { error: memberError } = await supabase.from("team_members").insert(input.anchorProfileIds.map((profileId) => ({ team_id: data.id, profile_id: profileId })));
    if (memberError) fail(memberError);
  }
  return data;
}

export async function updateTeam(id: string, input: { name?: string; hostProfileId?: string; status?: "active" | "disabled" }) {
  const { error } = await getBrowserSupabase()
    .from("teams")
    .update({ name: input.name, host_profile_id: input.hostProfileId, status: input.status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(error);
}

export async function deleteTeam(id: string) {
  const { error } = await getBrowserSupabase().from("teams").delete().eq("id", id);
  if (error) fail(error);
}

export async function addTeamMembers(teamId: string, anchorProfileIds: string[]) {
  if (!anchorProfileIds.length) return;
  const { error } = await getBrowserSupabase().from("team_members").insert(anchorProfileIds.map((profileId) => ({ team_id: teamId, profile_id: profileId })));
  if (error) fail(error);
}

export async function removeTeamMember(teamId: string, profileId: string) {
  const { error } = await getBrowserSupabase().from("team_members").delete().eq("team_id", teamId).eq("profile_id", profileId);
  if (error) fail(error);
}
