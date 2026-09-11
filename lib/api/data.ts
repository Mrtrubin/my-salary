import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import type { Database, Json } from "@/lib/supabase/database.types";
import { aggregateSettlement } from "@/lib/domain/settlement/aggregate";
import type { SettlementMemberContext, SettlementPerfRow } from "@/lib/domain/settlement/aggregate";
import { getPeriodRange } from "@/lib/domain/settlement/cycle";
import type { PeriodRange, SettlementType } from "@/lib/domain/settlement/cycle";
import { applyAdjustments } from "@/lib/domain/payroll/adjustment";
import type { PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import { calculateAnchorPayroll } from "@/lib/domain/payroll/anchor";

export type SalaryRecordStatus = Database["public"]["Enums"]["salary_record_status"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Position = Database["public"]["Tables"]["positions"]["Row"];
export type SalaryScheme = Database["public"]["Tables"]["salary_schemes"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "name"> | null };
export type SalaryRecord = Database["public"]["Tables"]["salary_records"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "code" | "name"> | null; team: Pick<Team, "id" | "name" | "settlement_type" | "settlement_start_day"> | null };
export type SalaryStatusLog = Database["public"]["Tables"]["salary_record_status_logs"]["Row"] & { operator: Pick<Profile, "name"> | null };
export type Member = Profile & { user_positions: { position: Position | null }[] };

const settlementErrors: Record<string, string> = {
  SYSTEM_SETTLEMENT_SETTINGS_MISSING: "系统结算配置不存在，请先完成数据库迁移",
  SETTLEMENT_PERIOD_MUST_MATCH_SYSTEM: "周期已与系统配置不一致，请刷新后重新选择",
  INVALID_SETTLEMENT_PERIOD: "结算周期无效",
  INVALID_SETTLEMENT_MEMBERS: "结算名单格式无效",
  DUPLICATE_SETTLEMENT_MEMBER_POSITION: "同一成员同一岗位不能重复结算",
  SALARY_RECORD_NOT_PENDING_REVIEW: "工资已进入审核后续流程，不能覆盖",
  INVALID_SALARY_ADJUSTMENTS: "工资调整项格式无效",
  SALARY_PERIOD_OVERLAP: "该成员岗位已有重叠周期工资，请先核对历史记录",
  TEAM_NOT_FOUND: "团队不存在",
};
function fail(error: { message: string; code?: string } | null): never {
  const message = Object.entries(settlementErrors).find(([code]) => error?.message.includes(code))?.[1]
    ?? (error?.code === "40001" || error?.code === "40P01" ? "结算操作并发冲突，请稍后重试" : error?.message)
    ?? "数据请求失败";
  throw new ApiError(error?.code === "42501" ? ApiErrorCode.FORBIDDEN : ApiErrorCode.UNKNOWN, message, error);
}

/** 仅重试数据库已回滚的事务冲突，不重试业务错误或未知网络结果。 */
async function retrySettlement<T extends { error: { code?: string } | null }>(operation: () => PromiseLike<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await operation();
    if (!result.error || !["40001", "40P01"].includes(result.error.code ?? "") || attempt >= 2) return result;
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
}

/** Supabase 默认截断结果集，结算读取必须完整分页并使用稳定排序。 */
async function readSettlementRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) fail(error);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export type SystemSettlementSettings = Database["public"]["Tables"]["system_settlement_settings"]["Row"];
export async function getSystemSettlementSettings(): Promise<SystemSettlementSettings> {
  const { data, error } = await getBrowserSupabase().from("system_settlement_settings").select("*").eq("id", true).maybeSingle();
  if (error) fail(error);
  if (!data) fail({ message: "SYSTEM_SETTLEMENT_SETTINGS_MISSING" });
  return data;
}
export async function updateSystemSettlementSettings(input: { settlementType: SettlementType; settlementStartDay: number }) {
  if (!Number.isInteger(input.settlementStartDay) || input.settlementStartDay < 1 || input.settlementStartDay > 28) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "周期起始日必须为 1～28 的整数");
  }
  const { data, error } = await getBrowserSupabase().from("system_settlement_settings").update({
    settlement_type: input.settlementType,
    settlement_start_day: input.settlementType === "monthly" ? 1 : input.settlementStartDay,
  }).eq("id", true).select("id").maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError(ApiErrorCode.FORBIDDEN, "系统配置未更新，请检查管理员权限或配置是否存在");
}

export function settlementMemberKey(member: { profileId: string; positionId: number }): string {
  return `${member.profileId}:${member.positionId}`;
}

export function parseSalaryAdjustments(value: Json): PayrollAdjustment[] {
  if (!Array.isArray(value)) throw new ApiError(ApiErrorCode.INVALID_INPUT, "已保存调整项格式错误，请核对工资记录");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string"
      || typeof item.amountCents !== "number" || !Number.isSafeInteger(item.amountCents)) {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "已保存调整项格式错误，请核对工资记录");
    }
    return { name: item.name, amountCents: item.amountCents };
  });
}

export async function getCurrentProfile(): Promise<Member | null> {
  const supabase = getBrowserSupabase();
  // 使用 getSession() 读取本地持久化会话，避免每次都向 Supabase 发起 getUser() 网络校验请求
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase.from("profiles").select("*, user_positions(position:positions(*))").eq("auth_user_id", userId).maybeSingle();
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
export interface UpdateAnchorSettingsInput {
  id: string;
  anchorType: Database["public"]["Enums"]["anchor_type"];
  baseCommissionRateBps: number;
}

/** 管理员更新主播资料级配置；保底方案由版本化 salary_schemes 单独保存。 */
export async function updateAnchorSettings(input: UpdateAnchorSettingsInput): Promise<{ id: string }> {
  if (!Number.isInteger(input.baseCommissionRateBps)
    || input.baseCommissionRateBps < 1
    || input.baseCommissionRateBps > 10000) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础提成率必须在 0.01%～100% 之间");
  }
  const { data, error } = await getBrowserSupabase().from("profiles").update({
    anchor_type: input.anchorType,
    anchor_base_commission_bps: input.baseCommissionRateBps,
    updated_at: new Date().toISOString(),
  }).eq("id", input.id).select("id").maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError(ApiErrorCode.FORBIDDEN, "主播配置未更新，请检查管理员权限");
  return data;
}

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

export interface PositionInput {
  /** 职位编码（必填，唯一，非空）。 */
  code: string;
  /** 职位名称（必填，唯一，非空）。 */
  name: string;
}

/** 管理员新增职位。 */
export async function createPosition(input: PositionInput): Promise<Position> {
  const { data, error } = await getBrowserSupabase()
    .from("positions")
    .insert({ code: input.code.trim(), name: input.name.trim() })
    .select()
    .single();
  if (error) fail(error);
  return data;
}

/** 管理员编辑职位（code/name）。 */
export async function updatePosition(id: number, input: Partial<PositionInput>): Promise<Position> {
  const body: Database["public"]["Tables"]["positions"]["Update"] = {};
  if (input.code !== undefined) body.code = input.code.trim();
  if (input.name !== undefined) body.name = input.name.trim();
  const { data, error } = await getBrowserSupabase().from("positions").update(body).eq("id", id).select().single();
  if (error) fail(error);
  return data;
}

/** 团队每日绩效记录（含关联团队名 / 绩效点名 / 成员名）。 */
export interface TeamPerformanceRow {
  id: string;
  team_id: string;
  profile_id: string;
  point_id: string | null;
  perf_date: string;
  broadcast_minutes: number;
  points_amount: number;
  revenue_cents: number;
  no_perf: boolean;
  no_perf_note: string | null;
  created_at: string;
  team: { name: string } | null;
  point: { name: string } | null;
  profile: { name: string } | null;
}

/**
 * 查询团队每日绩效记录。RLS 已限制：主持人只读本团队、成员只读自己、管理员读全量。
 * 按日期倒序返回，页面再按「团队 + 日期」聚合成卡片。
 */
export async function listTeamPerformance(range?: { start?: string; end?: string }): Promise<TeamPerformanceRow[]> {
  let query = getBrowserSupabase()
    .from("anchor_revenue_records")
    .select(
      "*, team:teams(name), point:performance_points(name), profile:profiles!anchor_revenue_records_profile_id_fkey(name)",
    )
    .order("perf_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (range?.start) query = query.gte("perf_date", range.start);
  if (range?.end) query = query.lte("perf_date", range.end);
  const { data, error } = await query;
  if (error) fail(error);
  return data as unknown as TeamPerformanceRow[];
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
 * 为团队内每名成员各录一条当日绩效记录。
 *
 * 唯一 key 为 (team_id, perf_date, profile_id)：重新提交同一天同一成员时直接更新（upsert），
 * 不再新建记录、也没有审核状态与作废概念。
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
    profile_id: item.profileId,
    point_id: item.noPerf ? null : item.pointId,
    perf_date: input.perfDate,
    broadcast_minutes: input.broadcastMinutes,
    points_amount: item.noPerf ? 0 : item.pointsAmount,
    revenue_cents: item.noPerf ? 0 : item.revenueCents,
    no_perf: item.noPerf,
    no_perf_note: item.noPerf ? (item.noPerfNote?.slice(0, 20) || "停播") : null,
    updated_at: now,
  }));
  const { error } =await getBrowserSupabase()
    .from("anchor_revenue_records")
    .upsert(rows, { onConflict: "team_id,perf_date,profile_id" });
  if (error) fail(error);
}

/**
 * 主持人重新上传（覆盖）某团队某日绩效：按成员维度做增量更新，用于卡片「编辑」入口。
 *
 * 规则：
 * - 逐成员与当日现有记录对比，完全一致的跳过（不写库）；
 * - 仅对有变化的成员做 upsert（按 team_id+perf_date+profile_id 唯一 key 直接更新，不新建）；
 * - 全部一致时不做任何写库。
 */
export async function replaceTeamPerformanceRecords(input: {
  teamId: string;
  hostProfileId: string;
  perfDate: string;
  broadcastMinutes: number;
  items: TeamPerformanceUploadItem[];
}) {
  const supabase = getBrowserSupabase();

  // 1. 读取当日现有记录，用于逐成员对比「是否有变化」。
  const { data: existingRows, error: readError } = await supabase
    .from("anchor_revenue_records")
    .select("profile_id, point_id, points_amount, revenue_cents, no_perf, no_perf_note, broadcast_minutes")
    .eq("team_id", input.teamId)
    .eq("perf_date", input.perfDate);
  if (readError) fail(readError);
  const existingByProfile = new Map(
    (existingRows as unknown as {
      profile_id: string; point_id: string | null; points_amount: number;
      revenue_cents: number; no_perf: boolean; no_perf_note: string | null; broadcast_minutes: number;
    }[]).map((r) => [r.profile_id, r]),
  );

  // 2. 逐成员比对：与现有记录完全一致的跳过，有变化的才 upsert。
  const changedItems: TeamPerformanceUploadItem[] = [];
  for (const item of input.items) {
    const prev = existingByProfile.get(item.profileId);
    const nextPointId = item.noPerf ? null : item.pointId;
    const nextPointsAmount = item.noPerf ? 0 : item.pointsAmount;
    const nextRevenueCents = item.noPerf ? 0 : item.revenueCents;
    const nextNote = item.noPerf ? (item.noPerfNote?.slice(0, 20) || "停播") : null;
    const same =
      prev &&
      prev.point_id === nextPointId &&
      prev.points_amount === nextPointsAmount &&
      prev.revenue_cents === nextRevenueCents &&
      prev.no_perf === item.noPerf &&
      prev.no_perf_note === nextNote &&
      prev.broadcast_minutes === input.broadcastMinutes;
    if (!same) changedItems.push(item);
  }

  // 3. 全部一致：无需任何写库，直接返回。
  if (!changedItems.length) return;

  // 4. 仅对「有变化的成员」做 upsert（同 key 直接更新，不新建）。
  await createTeamPerformanceRecords({ ...input, items: changedItems });
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
  const { data, error } = await getBrowserSupabase().from("salary_records").select("*, profile:profiles!salary_records_profile_id_fkey(name), position:positions(code, name), team:teams(id, name, settlement_type, settlement_start_day)").order("month", { ascending: false });
  if (error) fail(error);
  return data as unknown as SalaryRecord[];
}

/**
 * 薪资状态流转（四态状态机）：校验合法转换 → 更新主表 status + 对应最新时间戳 + 操作人 →
 * 写状态变更历史日志。审核通过（→pending_confirm）时给成员发「工资条待确认」站内通知。
 * @param id 薪资记录 ID
 * @param toStatus 目标状态
 * @param options.operatorProfileId 操作人（管理员确认到账/审核用；成员确认可不传）
 * @param options.note 日志备注
 */
export async function transitionSalaryStatus(
  id: string,
  toStatus: SalaryRecordStatus,
  options?: { operatorProfileId?: string; note?: string },
): Promise<void> {
  const supabase = getBrowserSupabase();
  // 事务原子性：主表更新 + 日志 + 通知在数据库端 RPC 单事务内完成，
  // 并对目标记录加行锁（select for update）防并发流转互相覆盖。
  // 合法转换/权限/乐观锁校验均下沉到 transition_salary_status，失败整体回滚。
  const { error } = await supabase.rpc("transition_salary_status", {
    p_id: id,
    p_to_status: toStatus,
    p_operator_profile_id: options?.operatorProfileId ?? null,
    p_note: options?.note ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    // 将 RPC 抛出的领域错误映射为应用层错误码。
    if (msg.includes("SALARY_RECORD_NOT_FOUND")) {
      throw new ApiError(ApiErrorCode.NOT_FOUND, "薪资记录不存在");
    }
    if (msg.includes("FORBIDDEN_TRANSITION")) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, "无权执行该状态流转");
    }
    if (msg.includes("INVALID_TRANSITION")) {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, `不允许流转到「${toStatus}」`);
    }
    fail(error);
  }
}

/**
 * 驳回并重算：按工资保存周期和岗位汇总本人跨团流水，保留并重新应用原调整项，
 * 原地更新同一条记录并重置为 pending_review（无 reject_reason），插日志
 * (from=pending_review, to=pending_review, note 记录驳回重算)。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 操作人现由 recompute_salary_record RPC 服务端权威推导（current_profile_id），入参保留仅为调用方兼容。
export async function rejectAndRecompute(id: string, _options?: { operatorProfileId?: string }): Promise<void> {
  const supabase = getBrowserSupabase();
  const { data: record, error: readError } = await supabase
    .from("salary_records")
    .select("id, status, profile_id, position_id, scheme_id, period_start, period_end, adjustments, attendance_bonus_bps, dy_task_bonus_bps")
    .eq("id", id)
    .single();
  if (readError) fail(readError);

  if (record.status !== "pending_review") {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "仅待审核工资条可驳回重算");
  }
  if (!record.period_start || !record.period_end) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "该记录缺少周期信息，无法重算");
  }
  const period = { start: record.period_start, end: record.period_end };
  const adjustments = parseSalaryAdjustments(record.adjustments);

  // 历史工资始终使用保存周期和岗位，不依赖当前团队或系统周期配置。
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("hire_date, anchor_type, anchor_base_commission_bps")
    .eq("id", record.profile_id)
    .single();
  if (profileError) fail(profileError);

  const [context] = await loadSettlementContexts([{
    profileId: record.profile_id,
    positionId: record.position_id,
    hireDate: profile.hire_date,
    anchorType: profile.anchor_type,
    baseCommissionRateBps: profile.anchor_base_commission_bps,
  }], period);
  if (!context.scheme) throw new ApiError(ApiErrorCode.INVALID_INPUT, "该成员岗位无周期内生效工资方案，无法重算");
  const perfRows = await readProfileRevenue([record.profile_id], period);
  const [draft] = aggregateSettlement(period, [context], perfRows.filter((r) => !r.noPerf));
  const adjusted = applyAdjustments(calculateAnchorPayroll({
    scheme: context.scheme,
    monthlyRevenueInCents: draft.revenueCents,
    tenureMonth: draft.tenureMonth,
    lastMonthQualified: context.lastMonthQualified,
    attendanceBonusBps: record.attendance_bonus_bps,
    dyTaskBonusBps: record.dy_task_bonus_bps,
 baseCommissionRateBps: context.baseCommissionRateBps,
  }), adjustments);

  // 单事务更新快照和日志；现有 RPC 不修改方案关联、保存周期或调整项。
  const { error: rpcError } = await retrySettlement(() => supabase.rpc("recompute_salary_record", {
    p_id: id,
    p_revenue_cents: draft.revenueCents,
    p_tenure_month: draft.tenureMonth,
    p_base_guarantee_cents: draft.baseGuaranteeCents,
    p_threshold_cents: draft.thresholdCents,
    p_commission_start_cents: draft.commissionStartCents,
    p_commission_rate_bps: adjusted.commissionRateBps,
    p_is_qualified: draft.isQualified,
    p_is_grace_period: draft.isGracePeriod,
    p_guaranteed_component_cents: draft.guaranteedComponentCents,
    p_performance_component_cents: adjusted.performanceComponentInCents,
    p_gross_cents: adjusted.grossSalaryInCents,
    p_service_fee_cents: adjusted.serviceFeeInCents,
    p_net_cents: adjusted.netSalaryInCents,
    p_note: `管理员驳回，按保存周期跨团重算并保留调整项；计算方案 ${context.schemeId}（原方案关联 ${record.scheme_id ?? "无"} 保持不变）`,
  }));
  if (rpcError) {
    const msg = rpcError.message ?? "";
    if (msg.includes("SALARY_RECORD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "工资记录不存在");
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权驳回重算");
    if (msg.includes("INVALID_TRANSITION")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "仅待审核工资条可驳回重算");
    fail(rpcError);
  }
}

/** 查询某条薪资记录的完整状态变更轨迹（精确到秒，按时间正序）。 */
export async function listSalaryStatusLogs(salaryRecordId: string): Promise<SalaryStatusLog[]> {
  const { data, error } = await getBrowserSupabase()
    .from("salary_record_status_logs")
    .select("*, operator:profiles!salary_record_status_logs_operator_profile_id_fkey(name)")
    .eq("salary_record_id", salaryRecordId)
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return data as unknown as SalaryStatusLog[];
}

/**
 * 成员确认工资条：pending_confirm → confirmed。
 * 复用 transitionSalaryStatus 完成校验、主表时间戳(confirmed_at)、操作人(confirmed_by)、日志写入。
 * @param id 工资记录 id
 * @param profileId 当前成员 profile id（作为操作人与 confirmed_by）
 */
export async function confirmSalaryRecord(id: string, profileId: string): Promise<void> {
  await transitionSalaryStatus(id, "confirmed", { operatorProfileId: profileId, note: "成员确认收款" });
}

export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

/** 查询当前成员的站内通知，按创建时间倒序。 */
export async function listNotifications(profileId: string): Promise<Notification[]> {
  const { data, error } = await getBrowserSupabase()
    .from("notifications")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) fail(error);
  return data as Notification[];
}

/** 标记单条通知为已读。 */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(error);
}

/** 标记当前成员的全部未读通知为已读。 */
export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("read_at", null);
  if (error) fail(error);
}

export type Team = Database["public"]["Tables"]["teams"]["Row"] & { host: Pick<Profile, "id" | "name"> | null; members: { profile: Pick<Profile, "id" | "name"> | null }[]; points: { point: Pick<PerformancePoint, "id" | "name" | "points_per_yuan"> | null }[] };

export async function listTeams(): Promise<Team[]> {
  const { data, error } = await getBrowserSupabase()
    .from("teams")
    .select("*, host:profiles!teams_host_profile_id_fkey(id, name), members:team_members(profile:profiles(id,name)), points:team_performance_points(point:performance_points(id,name,points_per_yuan))")
    .is("members.left_at", null)
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
    .update({
      name: input.name,
      host_profile_id: input.hostProfileId,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
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
  // 软删除：写入 left_at 保留在组历史，成员可回溯并支持日后重新入组；
  // 仅结束当前活跃区间（left_at is null）。
  const { error } = await getBrowserSupabase()
    .from("team_members")
    .update({ left_at: new Date().toISOString().slice(0, 10) })
    .eq("team_id", teamId)
    .eq("profile_id", profileId)
    .is("left_at", null);
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

// ==================== 主播流水结算（PLAN-001：/admin/anchor-revenue）====================

/** 按系统唯一配置解析周期；默认使用本地日历日。 */
export function resolveSystemPeriod(settings: Pick<SystemSettlementSettings, "settlement_type" | "settlement_start_day">, asOfDate?: string): PeriodRange {
  const now = new Date();
  const date = asOfDate ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return getPeriodRange(settings.settlement_type, settings.settlement_start_day, date);
}

/** 兼容旧调用方；团队字段仅是系统配置的镜像。 */
export function resolveTeamPeriod(team: Pick<Team, "settlement_type" | "settlement_start_day">, asOfDate?: string): PeriodRange {
  return resolveSystemPeriod(team, asOfDate);
}

/** 历史关系与流水发现离组人员，系统范围另外包含无团队主播。 */
async function getSettlementProfileIds(teamId: string | null, period?: PeriodRange): Promise<string[]> {
  const supabase = getBrowserSupabase();
  const memberships = await readSettlementRows((from, to) => {
    let query = supabase.from("team_members").select("id, profile_id");
    if (teamId) query = query.eq("team_id", teamId);
    if (period) query = query.lte("joined_at", period.end).or(`left_at.is.null,left_at.gte.${period.start}`);
    return query.order("id").range(from, to);
  });
  const revenues = await readSettlementRows((from, to) => {
    let query = supabase.from("anchor_revenue_records").select("id, profile_id");
    if (teamId) query = query.eq("team_id", teamId);
    if (period) query = query.gte("perf_date", period.start).lte("perf_date", period.end);
    return query.order("id").range(from, to);
  });
  const ids = new Set([...memberships, ...revenues].map((r) => r.profile_id));
  if (!teamId) {
    const anchors = await readSettlementRows((from, to) => supabase.from("user_positions")
      .select("profile_id, position:positions!inner(code), profile:profiles!inner(hire_date)")
      .eq("position.code", "anchor").lte("profile.hire_date", period?.end ?? "9999-12-31")
      .order("profile_id").order("position_id").range(from, to));
    for (const row of anchors) ids.add(row.profile_id);
  }
  return [...ids];
}

/** 保留每条来源团队流水，不按主播和日期去重。 */
export interface AnchorRevenuePerfRow {
  teamId: string;
  teamName: string | null;
  id: string;
  profileId: string;
  profileName: string | null;
  perfDate: string;
  revenueCents: number;
  broadcastMinutes: number;
  pointName: string | null;
  noPerf: boolean;
  noPerfNote: string | null;
  createdAt: string;
}

/** 团队仅筛人员，返回名单成员在周期内所有团队的流水。 */
export async function listAnchorRevenuePerf(teamId: string | null, periodStart: string, periodEnd: string): Promise<AnchorRevenuePerfRow[]> {
  const profileIds = await getSettlementProfileIds(teamId, { start: periodStart, end: periodEnd });
  return readProfileRevenue(profileIds, { start: periodStart, end: periodEnd });
}

async function readProfileRevenue(profileIds: string[], period: PeriodRange): Promise<AnchorRevenuePerfRow[]> {
  const supabase = getBrowserSupabase();
  const rows: AnchorRevenuePerfRow[] = [];
  const uniqueIds = [...new Set(profileIds)];
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const ids = uniqueIds.slice(i, i + 100);
    const data = await readSettlementRows((from, to) => supabase.from("anchor_revenue_records")
      .select("id, team_id, profile_id, perf_date, revenue_cents, broadcast_minutes, no_perf, no_perf_note, created_at, team:teams(name), point:performance_points(name), profile:profiles!anchor_revenue_records_profile_id_fkey(name)")
      .in("profile_id", ids).gte("perf_date", period.start).lte("perf_date", period.end)
      .order("perf_date", { ascending: false }).order("created_at", { ascending: false }).order("id")
      .range(from, to));
    rows.push(...data.map((r) => ({
      id: r.id, teamId: r.team_id, teamName: r.team?.name ?? null,
      profileId: r.profile_id, profileName: r.profile?.name ?? null,
      perfDate: r.perf_date, revenueCents: r.revenue_cents, broadcastMinutes: r.broadcast_minutes,
      pointName: r.point?.name ?? null, noPerf: r.no_perf, noPerfNote: r.no_perf_note, createdAt: r.created_at,
    })));
  }
  return rows.sort((a, b) => b.perfDate.localeCompare(a.perfDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** 名单人员跨团最早流水日期；空团队查询全系统，用于历史周期下界。 */
export async function getTeamEarliestPerfDate(teamId: string | null): Promise<string | null> {
  const supabase = getBrowserSupabase();
  const ids = teamId ? await getSettlementProfileIds(teamId) : null;
  let earliest: string | null = null;
  for (let i = 0; i < (ids?.length ?? 1); i += 100) {
    let query = supabase.from("anchor_revenue_records").select("perf_date");
    if (ids) query = query.in("profile_id", ids.slice(i, i + 100));
    const { data, error } = await query.order("perf_date").limit(1).maybeSingle();
    if (error) fail(error);
    if (data && (!earliest || data.perf_date < earliest)) earliest = data.perf_date;
  }
  return earliest;
}

/**
 * 拉取系统或团队名单在指定周期内的主播岗位、有效方案与名称映射。
 * 团队仅筛名单，供前端结合本人跨团流水实时试算（不落库）。
 * 无生效方案仍返回成员用于展示流水，但不允许结算。
 */
export async function getAnchorSettlementContexts(teamId: string | null, period: PeriodRange): Promise<{ members: SettlementMemberContext[]; profileNames: Record<string, string> }> {
  const supabase = getBrowserSupabase();

  const profileIds = await getSettlementProfileIds(teamId, period);
  const { data: anchorPosition, error: positionError } = await supabase.from("positions").select("id").eq("code", "anchor").maybeSingle();
  if (positionError) fail(positionError);
  if (!anchorPosition) throw new ApiError(ApiErrorCode.INVALID_INPUT, "未配置主播岗位，无法生成结算名单");
  const members: SettlementMemberContext[] = [];
  const profileNames: Record<string, string> = {};
  for (let i = 0; i < profileIds.length; i += 100) {
    const ids = profileIds.slice(i, i + 100);
    const profiles = await readSettlementRows((from, to) => supabase.from("profiles")
      .select("id, name, hire_date, anchor_type, anchor_base_commission_bps").in("id", ids).order("id").range(from, to));
    const identities = profiles.map((p) => {
      profileNames[p.id] = p.name;
      return {
        profileId: p.id,
        positionId: anchorPosition.id,
        hireDate: p.hire_date,
        anchorType: p.anchor_type,
        baseCommissionRateBps: p.anchor_base_commission_bps,
      };
    });
    members.push(...await loadSettlementContexts(identities, period));
  }
  return { members, profileNames };
}

/** 试算、结算、重算共用：个人有效方案优先，其次同岗位模板；上期达标跨团。 */
async function loadSettlementContexts(
  identities: Pick<SettlementMemberContext, "profileId" | "positionId" | "hireDate" | "anchorType" | "baseCommissionRateBps">[],
  period: PeriodRange,
): Promise<SettlementMemberContext[]> {
  if (!identities.length) return [];
  const supabase = getBrowserSupabase();
  const profileIds = [...new Set(identities.map((m) => m.profileId))];
  const positionIds = [...new Set(identities.map((m) => m.positionId))];
  const schemes = await readSettlementRows((from, to) => supabase.from("salary_schemes")
    .select("*").in("position_id", positionIds)
    .or(`profile_id.is.null,profile_id.in.(${profileIds.join(",")})`)
    .eq("status", "active").lte("effective_from", period.end)
    .order("effective_from", { ascending: false }).order("version", { ascending: false }).order("id")
    .range(from, to));
  const previous = await readSettlementRows((from, to) => supabase.from("salary_records")
    .select("id, profile_id, position_id, is_qualified, period_end")
    .in("profile_id", profileIds).in("position_id", positionIds).lt("period_end", period.start)
    .order("period_end", { ascending: false }).order("id").range(from, to));
  const personal = new Map<string, typeof schemes[number]>();
  const templates = new Map<number, typeof schemes[number]>();
  for (const scheme of schemes) {
    if (scheme.position_id === null) continue;
    if (scheme.profile_id === null) {
      if (!templates.has(scheme.position_id)) templates.set(scheme.position_id, scheme);
    } else {
      const key = settlementMemberKey({ profileId: scheme.profile_id, positionId: scheme.position_id });
      if (!personal.has(key)) personal.set(key, scheme);
    }
  }
  const qualified = new Map<string, boolean>();
  for (const record of previous) {
    const key = settlementMemberKey({ profileId: record.profile_id, positionId: record.position_id });
    if (!qualified.has(key)) qualified.set(key, record.is_qualified);
  }
  const unique = new Map(identities.map((m) => [settlementMemberKey(m), m]));
  return [...unique].map(([key, identity]) => {
    const scheme = personal.get(key) ?? templates.get(identity.positionId);
    return {
      ...identity,
      schemeId: scheme?.id ?? null,
      scheme: scheme ? {
        baseSalaryInCents: scheme.base_salary_cents,
        guaranteedSalaryInCents: scheme.guaranteed_salary_cents,
        thresholdMultiplierBps: scheme.threshold_multiplier_bps,
      } : null,
      lastMonthQualified: qualified.get(key) ?? true,
    };
  });
}

/** 单个主播岗位的结算入参与本次调整项。 */
export interface AnchorSettleMember {
  profileId: string;
  positionId: number;
  attendanceBonusBps?: number;
  dyTaskBonusBps?: number;
  adjustments?: PayrollAdjustment[];
}

/**
 * 管理员手动结算主播流水：对勾选主播按周期实时聚合 + 叠加调整项，落库进四态审核流。
 *
 * 流程：拉取周期流水与成员上下文 → [`aggregateSettlement()`](lib/domain/settlement/aggregate.ts:88)
 * 得基础工资草稿 → 逐主播 [`applyAdjustments()`](lib/domain/payroll/adjustment.ts) 叠加调整项
 * 重算总工资/服务费/实发 → 组装 p_members 调 settle_anchor_revenue RPC（单事务 upsert + 日志，
 * 仅允许管理员手动写入，不再提供自动结算入口）。
 */
export async function settleAnchorRevenue(input: { teamId: string | null; period: PeriodRange; members: AnchorSettleMember[] }): Promise<{ settledRecords: number }> {
  if (!input.members.length) throw new ApiError(ApiErrorCode.INVALID_INPUT, "请至少勾选一名主播");
  const selectedKeys = new Set(input.members.map(settlementMemberKey));
  if (selectedKeys.size !== input.members.length) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "同一成员同一岗位不能重复结算");
  }
  const supabase = getBrowserSupabase();

  // 团队只约束可选名单，身份始终为成员 + 岗位。
  const { members: allContexts } = await getAnchorSettlementContexts(input.teamId, input.period);
  const contexts = allContexts.filter((c) => selectedKeys.has(settlementMemberKey(c)) && c.scheme !== null);
  const contextsByKey = new Map(contexts.map((c) => [settlementMemberKey(c), c]));
  if (input.members.some((m) => !contextsByKey.has(settlementMemberKey(m)))) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "部分主播不在当前名单、岗位不匹配或缺少生效工资方案，无法结算");
  }

  // 仅读取已选人员的跨团流水，避免再次发现全量名单。
  const perfRows = await readProfileRevenue(contexts.map((c) => c.profileId), input.period);
  const settlementPerf: SettlementPerfRow[] = perfRows
    .filter((r) => !r.noPerf)
    .map((r) => ({ profileId: r.profileId, perfDate: r.perfDate, revenueCents: r.revenueCents, createdAt: r.createdAt }));

  const drafts = aggregateSettlement(input.period, contexts, settlementPerf);
  const membersByKey = new Map(input.members.map((m) => [settlementMemberKey(m), m]));

  // 按唯一人岗位叠加调整项，组装 RPC p_members。
  const payload = drafts.map((draft) => {
    const key = settlementMemberKey(draft);
    const context = contextsByKey.get(key)!;
    const { attendanceBonusBps = 0, dyTaskBonusBps = 0, adjustments = [] } = membersByKey.get(key)!;
    const base = calculateAnchorPayroll({
      scheme: context.scheme!,
      monthlyRevenueInCents: draft.revenueCents,
      tenureMonth: draft.tenureMonth,
      lastMonthQualified: context.lastMonthQualified,
      attendanceBonusBps,
      dyTaskBonusBps,
      baseCommissionRateBps: context.baseCommissionRateBps,
    });
    const adjusted = applyAdjustments(base, adjustments);
    return {
      profileId: draft.profileId,
      positionId: draft.positionId,
      schemeId: draft.schemeId,
      revenueCents: draft.revenueCents,
      tenureMonth: draft.tenureMonth,
      baseGuaranteeCents: draft.baseGuaranteeCents,
      thresholdCents: draft.thresholdCents,
      commissionStartCents: draft.commissionStartCents,
      commissionRateBps: base.commissionRateBps,
      attendanceBonusBps,
      dyTaskBonusBps,
      isQualified: draft.isQualified,
      isGracePeriod: draft.isGracePeriod,
      guaranteedComponentCents: draft.guaranteedComponentCents,
      performanceComponentCents: base.performanceComponentInCents,
      grossCents: adjusted.grossSalaryInCents,
      serviceFeeCents: adjusted.serviceFeeInCents,
      netCents: adjusted.netSalaryInCents,
      adjustments: adjusted.adjustments.map((a) => ({ name: a.name, amountCents: a.amountCents })),
    };
  });

  const { data, error } = await retrySettlement(() => supabase.rpc("settle_anchor_revenue", {
    p_team_id: input.teamId,
    p_period_start: input.period.start,
    p_period_end: input.period.end,
    p_members: payload as unknown as Json,
  }));
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权手动结算");
    if (msg.includes("TEAM_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "团队不存在");
    fail(error);
  }
  return { settledRecords: (data as number) ?? 0 };
}
