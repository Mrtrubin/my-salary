import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

export type PerformanceStatus = Database["public"]["Enums"]["performance_status"];
export type SalaryRecordStatus = Database["public"]["Enums"]["salary_record_status"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Position = Database["public"]["Tables"]["positions"]["Row"];
export type PerformanceRecord = Database["public"]["Tables"]["performance_records"]["Row"] & { profile: Pick<Profile, "name"> | null; host: Pick<Profile, "name"> | null };
export type SalaryScheme = Database["public"]["Tables"]["salary_schemes"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "name"> | null };
export type SalaryRecord = Database["public"]["Tables"]["salary_records"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "name"> | null };
export type Member = Profile & { user_positions: { position: Position | null }[] };

function fail(error: { message: string; code?: string } | null): never {
  throw new ApiError(error?.code === "42501" ? ApiErrorCode.FORBIDDEN : ApiErrorCode.UNKNOWN, error?.message ?? "数据请求失败", error);
}

export async function getCurrentProfile(): Promise<Member | null> {
  const supabase = getBrowserSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("profiles").select("*, user_positions(position:positions(*))").eq("auth_user_id", auth.user.id).maybeSingle();
  if (error) fail(error);
  return data as Member | null;
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await getBrowserSupabase().from("profiles").select("*, user_positions(position:positions(*))").order("name");
  if (error) fail(error);
  return data as Member[];
}

export interface CreateMemberInput {
  /** 用户名（必填，允许 UTF-8，唯一）。 */
  username: string;
  /** 登录密码（必填，6-64 位）。 */
  password: string;
  /** 入职日期（必填，YYYY-MM-DD）。 */
  hireDate: string;
  /** 显示姓名（选填，缺省使用用户名）。 */
  name?: string;
  /** 手机号（选填）。 */
  phone?: string;
  /** 联系邮箱（选填）。 */
  email?: string;
  /** 身份证号（选填）。 */
  idCard?: string;
  /** 职位 ID 列表（选填）。 */
  positionIds?: number[];
}
/**
 * 管理员新增成员：经 admin-create-member Edge Function（service role）
 * 一次性创建登录账号 + 成员资料 + 职位关联。普通客户端不可直接写 profiles。
 */
export async function createMember(input: CreateMemberInput): Promise<{ id: string }> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = getBrowserSupabase();
  const { data: sessionData } = await supabase.auth.getSession();

  const response = await fetch(`${url}/functions/v1/admin-create-member`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${sessionData.session?.access_token ?? anonKey}`,
    },
    body: JSON.stringify({
      username: input.username.trim(),
      password: input.password,
      name: input.name?.trim() ?? "",
      phone: input.phone?.trim() ?? "",
      email: input.email?.trim() ?? "",
      idCard: input.idCard?.trim() ?? "",
      hireDate: input.hireDate,
      positionIds: input.positionIds ?? [],
    }),
  });

  let body: { code?: string; message?: string; id?: string } = {};
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.UNKNOWN, "新增成员服务响应异常", response.status);
  }

  if (!response.ok) {
    if (body.code === "USERNAME_TAKEN") {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "该用户名已被占用");
    }
    if (body.code === "INVALID_INPUT") {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, body.message ?? "输入不合法");
    }
    if (body.code === "FORBIDDEN") {
      throw new ApiError(ApiErrorCode.FORBIDDEN, body.message ?? "仅管理员可新增成员");
    }
    throw new ApiError(ApiErrorCode.UNKNOWN, body.message ?? "新增成员失败，请稍后再试");
  }

  return { id: body.id ?? "" };
}

export async function setMemberStatus(id: string, status: "active" | "disabled") {
  const { error } = await getBrowserSupabase().from("profiles").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail(error);
}

export interface UpdateMemberInput {
  /** 成员资料 ID（必填）。 */
  id: string;
  /** 用户名（选填，传入才更新；唯一，1-32 位）。 */
  username?: string;
  /** 重置登录密码（选填，传入非空才重置；6-64 位）。 */
  password?: string;
  /** 显示姓名（选填，传入才更新，不能为空）。 */
  name?: string;
  /** 手机号（选填）。 */
  phone?: string;
  /** 联系邮箱（选填，传空串表示清空）。 */
  email?: string;
  /** 入职日期（选填，YYYY-MM-DD）。 */
  hireDate?: string;
  /** 身份证号（选填，传空串表示清空）。 */
  idCard?: string;
  /** 在职状态（选填）。 */
  status?: "active" | "disabled";
  /** 职位 ID 列表（选填，传入即按全量覆盖）。 */
  positionIds?: number[];
}

/**
 * 管理员编辑成员：经 admin-update-member Edge Function（service role）
 * 统一更新成员资料 + 职位关联 + 可选重置密码。未传字段保持不变。
 */
export async function updateMember(input: UpdateMemberInput): Promise<{ id: string }> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = getBrowserSupabase();
  const { data: sessionData } = await supabase.auth.getSession();

  const body: Record<string, unknown> = { id: input.id };
  if (input.username !== undefined) body.username = input.username.trim();
  if (input.password !== undefined && input.password !== "") body.password = input.password;
  if (input.name !== undefined) body.name = input.name.trim();
  if (input.phone !== undefined) body.phone = input.phone.trim();
  if (input.email !== undefined) body.email = input.email.trim();
  if (input.hireDate !== undefined) body.hireDate = input.hireDate;
  if (input.idCard !== undefined) body.idCard = input.idCard.trim();
  if (input.status !== undefined) body.status = input.status;
  if (input.positionIds !== undefined) body.positionIds = input.positionIds;

  const response = await fetch(`${url}/functions/v1/admin-update-member`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${sessionData.session?.access_token ?? anonKey}`,
    },
    body: JSON.stringify(body),
  });

  let result: { code?: string; message?: string; id?: string } = {};
  try {
    result = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.UNKNOWN, "编辑成员服务响应异常", response.status);
  }

  if (!response.ok) {
    if (result.code === "USERNAME_TAKEN") throw new ApiError(ApiErrorCode.INVALID_INPUT, "该用户名已被占用");
    if (result.code === "EMAIL_TAKEN") throw new ApiError(ApiErrorCode.INVALID_INPUT, "该邮箱已被占用");
    if (result.code === "INVALID_INPUT") throw new ApiError(ApiErrorCode.INVALID_INPUT, result.message ?? "输入不合法");
    if (result.code === "FORBIDDEN") throw new ApiError(ApiErrorCode.FORBIDDEN, result.message ?? "仅管理员可编辑成员");
    throw new ApiError(ApiErrorCode.UNKNOWN, result.message ?? "编辑成员失败，请稍后再试");
  }

  return { id: result.id ?? input.id };
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

// ==================== 成员资料修改申请（字段级审核）====================

export type ChangeRequestStatus = Database["public"]["Enums"]["change_request_status"];
export type ChangeableField = "name" | "phone" | "email" | "id_card";
export type ProfileChangeRequest = Database["public"]["Tables"]["profile_change_requests"]["Row"] & { profile: Pick<Profile, "name"> | null };

/** 成员可申请修改的字段 → 中文标签（用户端表单与管理端展示共用）。 */
export const EDITABLE_PROFILE_FIELDS: { field: ChangeableField; label: string; type: "text" | "email" }[] = [
  { field: "name", label: "姓名", type: "text" },
  { field: "phone", label: "手机号", type: "text" },
  { field: "email", label: "邮箱", type: "email" },
  { field: "id_card", label: "身份证号", type: "text" },
];

/** 成员查看自己的资料修改申请（含 pending 与历史）。 */
export async function listMyChangeRequests(): Promise<ProfileChangeRequest[]> {
  const supabase = getBrowserSupabase();
  const profileId = await getCurrentProfileId();
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("profile_change_requests")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return data as unknown as ProfileChangeRequest[];
}

/** 管理员查看全部待审核申请（关联申请人姓名）。 */
export async function listPendingChangeRequests(): Promise<ProfileChangeRequest[]> {
  const { data, error } = await getBrowserSupabase()
    .from("profile_change_requests")
    .select("*, profile:profiles!profile_change_requests_profile_id_fkey(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return data as unknown as ProfileChangeRequest[];
}

async function getCurrentProfileId(): Promise<string | null> {
  const supabase = getBrowserSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from("profiles").select("id").eq("auth_user_id", auth.user.id).maybeSingle();
  return data?.id ?? null;
}

async function callEdgeFunction(name: string, body: unknown): Promise<Record<string, unknown>> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = getBrowserSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${sessionData.session?.access_token ?? anonKey}` },
    body: JSON.stringify(body),
  });
  let result: Record<string, unknown> = {};
  try {
    result = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.UNKNOWN, "服务响应异常", response.status);
  }
  if (!response.ok) {
    const code = result.code as string | undefined;
    const message = (result.message as string | undefined) ?? "操作失败，请稍后再试";
    if (code === "FORBIDDEN") throw new ApiError(ApiErrorCode.FORBIDDEN, message);
    if (code === "INVALID_INPUT" || code === "EMAIL_TAKEN") throw new ApiError(ApiErrorCode.INVALID_INPUT, message);
    throw new ApiError(ApiErrorCode.UNKNOWN, message);
  }
  return result;
}

/** 成员批量提交资料修改申请（覆盖同字段旧 pending）。 */
export async function submitProfileChanges(changes: { field: ChangeableField; newValue: string }[]): Promise<{ batchId: string; count: number }> {
  const result = await callEdgeFunction("submit-profile-changes", { changes });
  return { batchId: (result.batchId as string) ?? "", count: (result.count as number) ?? 0 };
}

/** 管理员审核申请：approve / reject（reject 需 reason），支持单条/多条/一键。 */
export async function reviewProfileChanges(input: { ids: string[]; action: "approve" | "reject"; reason?: string }): Promise<{ approved: number; rejected: number }> {
  const result = await callEdgeFunction("review-profile-change", { ids: input.ids, action: input.action, reason: input.reason });
  return { approved: (result.approved as number) ?? 0, rejected: (result.rejected as number) ?? 0 };
}

/**
 * 成员提交「修改密码」申请（走管理员审核）。
 * 提交时用当前密码校验身份；新密码由 Edge Function 加密后存储，审核通过才写入 Auth。
 */
export async function submitPasswordChange(input: { currentPassword: string; newPassword: string }): Promise<{ batchId: string }> {
  const result = await callEdgeFunction("submit-password-change", { currentPassword: input.currentPassword, newPassword: input.newPassword });
  return { batchId: (result.batchId as string) ?? "" };
}
