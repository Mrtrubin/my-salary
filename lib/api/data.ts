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

/** 团队每日绩效记录（含关联团队名 / 绩效点名 / 成员名）。 */
export interface TeamPerformanceRow {
  id: string;
  team_id: string;
  host_profile_id: string;
  profile_id: string;
  point_id: string | null;
  perf_date: string;
  broadcast_minutes: number;
  points_amount: number;
  revenue_cents: number;
  no_perf: boolean;
  no_perf_note: string | null;
  status: PerformanceStatus;
  reject_reason: string | null;
  created_at: string;
  team: { name: string } | null;
  point: { name: string } | null;
  profile: { name: string } | null;
}

/**
 * 查询团队每日绩效记录。RLS 已限制：主持人只读本团队、成员只读自己、管理员读全量。
 * 按日期倒序返回，页面再按「团队 + 日期」聚合成卡片。
 */
export async function listTeamPerformance(): Promise<TeamPerformanceRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from("team_performance_records")
    .select(
      "*, team:teams(name), point:performance_points(name), profile:profiles!team_performance_records_profile_id_fkey(name)",
    )
    .order("perf_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return data as unknown as TeamPerformanceRow[];
}

export async function updatePerformanceStatus(id: string, status: PerformanceStatus, rejectReason?: string) {
  const { error } = await getBrowserSupabase().from("performance_records").update({ status, reject_reason: rejectReason ?? null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail(error);
}

/** 单条绩效上传项：指定主播、月份、营收（分）。 */
export interface PerformanceUploadItem {
  profileId: string;
  month: string;
  revenueCents: number;
}
/**
 * 主持人批量上传绩效：为本团队多名主播一次性创建绩效记录（status=pending 待审核）。
 * host_profile_id 记录当前主持人，便于审核溯源。
 */
export async function createPerformanceRecords(hostProfileId: string, items: PerformanceUploadItem[]) {
  if (!items.length) return;
  const now = new Date().toISOString();
  const rows = items.map((item) => ({
    profile_id: item.profileId,
    host_profile_id: hostProfileId,
    month: item.month,
    revenue_cents: item.revenueCents,
    status: "pending" as const,
    submitted_at: now,
  }));
  const { error } = await getBrowserSupabase().from("performance_records").insert(rows);
  if (error) fail(error);
}

/** 团队绩效单条上传项：某成员当日的绩效点/数量/流水，或无绩效备注。 */
export interface TeamPerformanceUploadItem {
  profileId: string;
  pointId: string;
  pointsAmount: number;
  revenueCents: number;
  noPerf: boolean;
  noPerfNote?: string;
}
/**
 * 主持人团队绩效批量上传：以「团队 + 单日 + 总开播时长」为一次批次，
 * 为团队内每名成员各录一条当日绩效记录（status=pending 待审核）。
 */
export async function createTeamPerformanceRecords(input: {
  teamId: string;
  hostProfileId: string;
  perfDate: string;
  broadcastMinutes: number;
  items: TeamPerformanceUploadItem[];
}) {
  if (!input.items.length) return;
  const now = new Date().toISOString();
  const rows = input.items.map((item) => ({
    team_id: input.teamId,
    host_profile_id: input.hostProfileId,
    profile_id: item.profileId,
    point_id: item.noPerf ? null : item.pointId,
    perf_date: input.perfDate,
    broadcast_minutes: input.broadcastMinutes,
    points_amount: item.noPerf ? 0 : item.pointsAmount,
    revenue_cents: item.noPerf ? 0 : item.revenueCents,
    no_perf: item.noPerf,
    no_perf_note: item.noPerf ? (item.noPerfNote?.slice(0, 20) || "停播") : null,
    // 团队绩效默认自动通过，管理员如有异议可再驳回。
    status: "approved" as const,
    submitted_at: now,
    reviewed_at: now,
  }));
  const { error } = await getBrowserSupabase().from("team_performance_records").insert(rows);
  if (error) fail(error);
}

/**
 * 主持人重新上传（覆盖）某团队某日绩效：先删除该团队当日全部旧记录，
 * 再按最新录入重新插入（status=approved 自动通过）。用于卡片「编辑」入口。
 */
export async function replaceTeamPerformanceRecords(input: {
  teamId: string;
  hostProfileId: string;
  perfDate: string;
  broadcastMinutes: number;
  items: TeamPerformanceUploadItem[];
}) {
  const supabase = getBrowserSupabase();
  const { error: delError } = await supabase
    .from("team_performance_records")
    .delete()
    .eq("team_id", input.teamId)
    .eq("perf_date", input.perfDate);
  if (delError) fail(delError);
  await createTeamPerformanceRecords(input);
}

/**
 * 管理员更新团队绩效记录状态：驳回需填原因，或将已驳回记录恢复为通过。
 */
export async function updateTeamPerformanceStatus(
  id: string,
  status: PerformanceStatus,
  rejectReason?: string,
) {
  const { error } = await getBrowserSupabase()
    .from("team_performance_records")
    .update({
      status,
      reject_reason: status === "rejected" ? (rejectReason ?? null) : null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
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

export type Team = Database["public"]["Tables"]["teams"]["Row"] & { host: Pick<Profile, "id" | "name"> | null; members: { profile: Pick<Profile, "id" | "name"> | null }[]; points: { point: Pick<PerformancePoint, "id" | "name" | "points_per_yuan"> | null }[] };

export async function listTeams(): Promise<Team[]> {
  const { data, error } = await getBrowserSupabase()
    .from("teams")
    .select("*, host:profiles!teams_host_profile_id_fkey(id, name), members:team_members(profile:profiles(id,name)), points:team_performance_points(point:performance_points(id,name,points_per_yuan))")
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

// ==================== 绩效点类型（全局字典:名称 + 换算率）====================

export type PerformancePoint = Database["public"]["Tables"]["performance_points"]["Row"];

/** 折算:绩效点数量 → 金额（分）。金额 = floor(点数 × 100 / 每元所需点数）。 */
export function convertPointsToCents(points: number, pointsPerYuan: number): number {
  if (!Number.isInteger(points) || points < 0 || !Number.isInteger(pointsPerYuan) || pointsPerYuan <= 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "绩效点数量须为非负整数，换算率须为正整数");
  }
  return Math.floor((points * 100) / pointsPerYuan);
}

/** 列出全部绩效点类型（全体登录用户可见）。 */
export async function listPerformancePoints(): Promise<PerformancePoint[]> {
  const { data, error } = await getBrowserSupabase()
    .from("performance_points")
    .select("*")
    .order("created_at");
  if (error) fail(error);
  return data;
}

/** 新增绩效点类型。 */
export async function createPerformancePoint(input: { name: string; pointsPerYuan: number }) {
  const { error } = await getBrowserSupabase()
    .from("performance_points")
    .insert({ name: input.name.trim(), points_per_yuan: input.pointsPerYuan });
  if (error) fail(error);
}

/** 更新绩效点类型（名称/换算率/状态）。 */
export async function updatePerformancePoint(id: string, input: { name?: string; pointsPerYuan?: number; status?: "active" | "disabled" }) {
  const { error } = await getBrowserSupabase()
    .from("performance_points")
    .update({ name: input.name?.trim(), points_per_yuan: input.pointsPerYuan, status: input.status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(error);
}

/** 删除绩效点类型。 */
export async function deletePerformancePoint(id: string) {
  const { error } = await getBrowserSupabase().from("performance_points").delete().eq("id", id);
  if (error) fail(error);
}

/** 为团队关联一个绩效点类型。 */
export async function addTeamPerformancePoint(teamId: string, pointId: string) {
  const { error } = await getBrowserSupabase()
    .from("team_performance_points")
    .insert({ team_id: teamId, point_id: pointId });
  if (error) fail(error);
}

/** 取消团队与某绩效点类型的关联。 */
export async function removeTeamPerformancePoint(teamId: string, pointId: string) {
  const { error } = await getBrowserSupabase()
    .from("team_performance_points")
    .delete()
    .eq("team_id", teamId)
    .eq("point_id", pointId);
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
