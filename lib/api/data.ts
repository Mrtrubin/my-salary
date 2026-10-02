import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { invokeEdgeFunction, isAuthFailure, isNetworkFailure, toNetworkError, type EdgeFunctionBody } from "@/lib/api/client";
import { REST_NOTE } from "@/lib/domain/performance/status";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { SettlementMemberContext } from "@/lib/domain/settlement/aggregate";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import type { PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import type { HostSalaryScheme } from "@/lib/domain/payroll/host";

export type SalaryRecordStatus = Database["public"]["Enums"]["salary_record_status"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Position = Database["public"]["Tables"]["positions"]["Row"];
export type SalaryScheme = Database["public"]["Tables"]["salary_schemes"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "name"> | null };
export type SalaryRecord = Database["public"]["Tables"]["salary_records"]["Row"] & { profile: Pick<Profile, "name"> | null; position: Pick<Position, "code" | "name"> | null; team: Pick<Team, "id" | "name"> | null };
export type SalaryStatusLog = Database["public"]["Tables"]["salary_record_status_logs"]["Row"] & { operator: Pick<Profile, "name"> | null };
export type Member = Profile & {
  user_positions: { position: Position | null }[];
  /** 按 (成员, 职位) 存储的基础薪资（元=分），用于「固定薪资 + 调整项」工资条。 */
  staff_base_incomes: { position_id: number; base_income_cents: number }[];
};

const settlementErrors: Record<string, string> = {
  INVALID_SETTLEMENT_PERIOD: "结算起止日期无效",
  INVALID_SALARY_PERIOD: "结算起止日期无效",
  INVALID_SETTLEMENT_MEMBERS: "结算名单格式无效",
  DUPLICATE_SETTLEMENT_MEMBER_POSITION: "同一成员同一岗位不能重复结算",
  SALARY_RECORD_NOT_PENDING_REVIEW: "工资已进入审核后续流程，不能覆盖",
  INVALID_SALARY_ADJUSTMENTS: "工资调整项格式无效",
  SALARY_PERIOD_OVERLAP: "该成员岗位已有重叠周期工资，请先核对历史记录",
  SALARY_OVERLAP_COMPLETED: "所选区间与已完成的工资记录重叠，无法覆盖结算",
  HOST_SALARY_PERIOD_OVERLAP: "该主持已有重叠周期工资，请先核对历史记录",
  HOST_SALARY_OVERLAP_COMPLETED: "所选区间与已完成的主持工资记录重叠，无法覆盖结算",
  TEAM_NOT_FOUND: "团队不存在",
};
function fail(error: { message: string; code?: string } | null): never {
  // 网络层失败（断网 / ERR_CONNECTION_RESET / 超时）走 NETWORK，保留可读文案。
  if (isNetworkFailure(error)) throw toNetworkError(error, "数据请求失败");
  // 登录态失效（JWT 过期/被撤销）：归一化为 UNAUTHENTICATED，交由全局处理清会话并回登录页。
  if (isAuthFailure(error)) throw new ApiError(ApiErrorCode.UNAUTHENTICATED, "登录状态已失效，请重新登录", error);
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
  const { data, error } = await supabase.from("profiles").select("*, user_positions(position:positions(*)), staff_base_incomes(position_id, base_income_cents)").eq("auth_user_id", userId).maybeSingle();
  if (error) fail(error);
  return data as Member | null;
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await getBrowserSupabase().from("profiles").select("*, user_positions(position:positions(*)), staff_base_incomes(position_id, base_income_cents)").order("name");
  if (error) fail(error);
  return data as unknown as Member[];
}

/** 读取某成员在某职位下的基础薪资（分）；未设置时返回 0。 */
export function staffBaseIncomeOf(member: Member | undefined, positionId: number | undefined): number {
  if (!member || !positionId) return 0;
  return member.staff_base_incomes?.find((item) => item.position_id === positionId)?.base_income_cents ?? 0;
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
  /** 抖音号（选填，唯一）。 */
  douyinId?: string;
  /** 职位 ID 列表（选填）。 */
  positionIds?: number[];
}
/**
 * 管理员新增成员：经 admin-create-member Edge Function（service role）：经 admin-create-member Edge Function（service role）
 * 一次性创建登录账号 + 成员资料 + 职位关联。普通客户端不可直接写 profiles。
 */
export async function createMember(input: CreateMemberInput): Promise<{ id: string }> {
  const body = await invokeEdgeFunction<{ id?: string; message?: string }>("admin-create-member", {
    username: input.username.trim(),
    password: input.password,
    name: input.name?.trim() ?? "",
    phone: input.phone?.trim() ?? "",
    email: input.email?.trim() ?? "",
    idCard: input.idCard?.trim() ?? "",
    douyinId: input.douyinId?.trim() ?? "",
    hireDate: input.hireDate,
    positionIds: input.positionIds ?? [],
  }, {
    fallbackMessage: "新增成员失败",
    codeMessages: {
      USERNAME_TAKEN: "该用户名已被占用",
      INVALID_INPUT: "输入不合法",
      FORBIDDEN: "仅管理员可新增成员",
    },
  });

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
  /** 抖音号（选填，唯一，传空串表示清空）。 */
  douyinId?: string;
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
  /**
   * 抖音号：填接口返回的 `user_id`（数字 uid）或 `aweme_display_id`（抖音号）都可以，
   * 用于拉取流水后自动识别主播。空串 / null 表示清除。
   */
  douyinId?: string | null;
}

/** 管理员更新主播资料级配置；保底方案由版本化 salary_schemes 单独保存。 */
export async function updateAnchorSettings(input: UpdateAnchorSettingsInput): Promise<{ id: string }> {
  if (!Number.isInteger(input.baseCommissionRateBps)
    || input.baseCommissionRateBps < 1
    || input.baseCommissionRateBps > 10000) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础提成率必须在 0.01%～100% 之间");
  }
  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
    anchor_type: input.anchorType,
    anchor_base_commission_bps: input.baseCommissionRateBps,
    updated_at: new Date().toISOString(),
  };
  if (input.douyinId !== undefined) {
    patch.douyin_id = (input.douyinId ?? "").trim() || null;
  }
  const { data, error } = await getBrowserSupabase().from("profiles")
    .update(patch).eq("id", input.id).select("id").maybeSingle();
  if (error) {
    // profiles_douyin_id_key 唯一索引：抖音号被别的成员占用时给出可读提示。
    if (error.code === "23505") {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "该抖音号已被其他成员使用，请核对后重试", error);
    }
    fail(error);
  }
  if (!data) throw new ApiError(ApiErrorCode.FORBIDDEN, "主播配置未更新，请检查管理员权限");
  return data;
}

export async function updateMember(input: UpdateMemberInput): Promise<{ id: string }> {
  const body: Record<string, unknown> = { id: input.id };
  if (input.username !== undefined) body.username = input.username.trim();
  if (input.password !== undefined && input.password !== "") body.password = input.password;
  if (input.name !== undefined) body.name = input.name.trim();
  if (input.phone !== undefined) body.phone = input.phone.trim();
  if (input.email !== undefined) body.email = input.email.trim();
  if (input.hireDate !== undefined) body.hireDate = input.hireDate;
  if (input.idCard !== undefined) body.idCard = input.idCard.trim();
  if (input.douyinId !== undefined) body.douyinId = input.douyinId.trim();
  if (input.status !== undefined) body.status = input.status;
  if (input.positionIds !== undefined) body.positionIds = input.positionIds;

  const result = await invokeEdgeFunction<{ id?: string }>("admin-update-member", body, {
    fallbackMessage: "编辑成员失败",
    codeMessages: {
      USERNAME_TAKEN: "该用户名已被占用",
      EMAIL_TAKEN: "该邮箱已被占用",
      INVALID_INPUT: "输入不合法",
      FORBIDDEN: "仅管理员可编辑成员",
    },
  });

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

/** 单条调整项：名称 + 数值（单位与业绩一致，可为负）。 */
export interface AnchorRevenueAdjustment {
  name: string;
  amount: number;
}

/** 把数据库 jsonb 容错解析为调整项数组（丢弃非法/零值项）。 */
export function parseAnchorRevenueAdjustments(value: unknown): AnchorRevenueAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { name?: unknown; amount?: unknown };
    const amount = Number(record.amount);
    if (!Number.isFinite(amount) || amount === 0) return [];
    const name = typeof record.name === "string" ? record.name.trim() : "";
    return [{ name, amount }];
  });
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
  /** 当日调整项折算金额（分，可正可负）。 */
  adjustment_cents: number;
  /** 当日逐条调整项明细（名称 + 数值）。 */
  adjustments: AnchorRevenueAdjustment[];
  no_perf: boolean;
  no_perf_note: string | null;
  created_at: string;
  team: { name: string; team_code: string } | null;
  point: { name: string } | null;
  profile: { name: string } | null;
  host: { name: string } | null;
}

/**
 * 查询团队每日绩效记录。RLS 已限制：主持人只读本团队、成员只读自己、管理员读全量。
 * 按日期倒序返回，页面再按「团队 + 日期」聚合成卡片。
 */
export async function listTeamPerformance(range?: { start?: string; end?: string }): Promise<TeamPerformanceRow[]> {
  let query = getBrowserSupabase()
    .from("anchor_revenue_records")
    .select(
      "*, team:teams(name, team_code), point:performance_points(name), profile:profiles!anchor_revenue_records_profile_id_fkey(name), host:profiles!anchor_revenue_records_host_profile_id_fkey(name)",
    )
    .order("perf_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (range?.start) query = query.gte("perf_date", range.start);
  if (range?.end) query = query.lte("perf_date", range.end);
  const { data, error } = await query;
  if (error) fail(error);
  const rows = data as unknown as (Omit<TeamPerformanceRow, "adjustments"> & { adjustments: unknown })[];
  return rows.map((row) => ({ ...row, adjustments: parseAnchorRevenueAdjustments(row.adjustments) }));
}

/** 团队绩效单条上传项：某成员当日的绩效点/数量/流水，或无绩效备注。 */
export interface TeamPerformanceUploadItem {
  profileId: string;
  pointId: string;
  pointsAmount: number;
  revenueCents: number;
  /** 该成员当日直播时长（分钟），按主播单独记录。 */
  broadcastMinutes: number;
  /** 该成员当日调整项折算金额（分，可正可负）。 */
  adjustmentCents: number;
  /** 该成员当日逐条调整项明细（名称 + 数值）。 */
  adjustments: AnchorRevenueAdjustment[];
  noPerf: boolean;
  noPerfNote?: string;
}
/**
 * 主持人团队绩效批量上传：以「团队 + 单日」为一次批次，
 * 为团队内每名成员各录一条当日绩效记录（含各自直播时长）。
 *
 * 唯一 key 为 (team_id, perf_date, profile_id)：重新提交同一天同一成员时直接更新（upsert），
 * 不再新建记录、也没有审核状态与作废概念。
 */
export async function createTeamPerformanceRecords(input: {
  teamId: string;
  hostProfileId: string;
  perfDate: string;
  items: TeamPerformanceUploadItem[];
}) {
  if (!input.items.length) return;
  const now = new Date().toISOString();
  const rows = input.items.map((item) => ({
    team_id: input.teamId,
    profile_id: item.profileId,
    point_id: item.noPerf ? null : (item.pointId || null),
    perf_date: input.perfDate,
    broadcast_minutes: item.noPerf ? 0 : item.broadcastMinutes,
    adjustment_cents: item.noPerf ? 0 : item.adjustmentCents,
    adjustments: (item.noPerf ? [] : item.adjustments) as unknown as Json,
    points_amount: item.noPerf ? 0 : item.pointsAmount,
    revenue_cents: item.noPerf ? 0 : item.revenueCents,
    no_perf: item.noPerf,
    no_perf_note: item.noPerf ? (item.noPerfNote?.slice(0, 20) || REST_NOTE) : null,
    host_profile_id: input.hostProfileId,
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
  items: TeamPerformanceUploadItem[];
}) {
  const supabase = getBrowserSupabase();

  // 1. 读取当日现有记录，用于逐成员对比「是否有变化」。
  const { data: existingRows, error: readError } = await supabase
    .from("anchor_revenue_records")
    .select("profile_id, point_id, points_amount, revenue_cents, no_perf, no_perf_note, broadcast_minutes, adjustment_cents, adjustments")
    .eq("team_id", input.teamId)
    .eq("perf_date", input.perfDate);
  if (readError) fail(readError);
  const existingByProfile = new Map(
    (existingRows as unknown as {
      profile_id: string; point_id: string | null; points_amount: number;
      revenue_cents: number; no_perf: boolean; no_perf_note: string | null; broadcast_minutes: number;
      adjustment_cents: number; adjustments: unknown;
    }[]).map((r) => [r.profile_id, r]),
  );

  // 2. 逐成员比对：与现有记录完全一致的跳过，有变化的才 upsert。
  const changedItems: TeamPerformanceUploadItem[] = [];
  for (const item of input.items) {
    const prev = existingByProfile.get(item.profileId);
    const nextPointId = item.noPerf ? null : item.pointId;
    const nextPointsAmount = item.noPerf ? 0 : item.pointsAmount;
    const nextRevenueCents = item.noPerf ? 0 : item.revenueCents;
    const nextNote = item.noPerf ? (item.noPerfNote?.slice(0, 20) || REST_NOTE) : null;
    const nextBroadcastMinutes = item.noPerf ? 0 : item.broadcastMinutes;
    const nextAdjustmentCents = item.noPerf ? 0 : item.adjustmentCents;
    const nextAdjustments = item.noPerf ? [] : item.adjustments;
    const same =
      prev &&
      prev.point_id === nextPointId &&
      prev.points_amount === nextPointsAmount &&
      prev.revenue_cents === nextRevenueCents &&
      prev.no_perf === item.noPerf &&
      prev.no_perf_note === nextNote &&
      prev.broadcast_minutes === nextBroadcastMinutes &&
      prev.adjustment_cents === nextAdjustmentCents &&
      JSON.stringify(parseAnchorRevenueAdjustments(prev.adjustments)) === JSON.stringify(nextAdjustments);
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
  const { data, error } = await getBrowserSupabase().from("salary_records").select("*, profile:profiles!salary_records_profile_id_fkey(name), position:positions(code, name), team:teams(id, name)").order("month", { ascending: false });
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

  // 方案 B：金额一律由数据库权威重算。前端不再读流水/入职日/方案，也不再算任何金额；
  // 未传加点/调整项时，recompute_salary_record 会沿用记录原有的加点与调整项。
  const { error: rpcError } = await retrySettlement(() => supabase.rpc("recompute_salary_record", {
    p_id: id,
    p_note: "管理员驳回，已按保存周期跨团流水由数据库权威重算并保留原加点与调整项",
  }));
  if (rpcError) {
    const msg = rpcError.message ?? "";
    if (msg.includes("SALARY_RECORD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "工资记录不存在");
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权驳回重算");
    if (msg.includes("INVALID_TRANSITION")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "仅待审核工资条可驳回重算");
    if (msg.includes("SALARY_SCHEME_MISSING")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "该成员岗位无周期内生效工资方案，无法重算");
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

export type Team = Database["public"]["Tables"]["teams"]["Row"] & { host: Pick<Profile, "id" | "name"> | null; members: { profile: Pick<Profile, "id" | "name" | "douyin_id"> | null }[]; points: { point: Pick<PerformancePoint, "id" | "name" | "points_per_yuan"> | null }[] };

export async function listTeams(): Promise<Team[]> {
  const { data, error } = await getBrowserSupabase()
    .from("teams")
    .select("*, host:profiles!teams_host_profile_id_fkey(id, name), members:team_members(profile:profiles(id,name,douyin_id)), points:team_performance_points(point:performance_points(id,name,points_per_yuan))")
    .is("members.left_at", null)
    .order("name");
  if (error) fail(error);
  return data as unknown as Team[];
}

export async function createTeam(input: { name: string; teamCode: string; hostProfileId: string; anchorProfileIds?: string[] }) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("teams").insert({ name: input.name, team_code: input.teamCode.trim(), host_profile_id: input.hostProfileId }).select().single();
  if (error) fail(error);
  if (input.anchorProfileIds?.length) {
    const { error: memberError } = await supabase.from("team_members").insert(input.anchorProfileIds.map((profileId) => ({ team_id: data.id, profile_id: profileId })));
    if (memberError) fail(memberError);
  }
  return data;
}

/**
 * 更新团队。团队 ID 与名称均仅管理员可改:RLS 的 teams_update 策略只放行 is_admin(),
 * 非管理员提交会被策略拦掉(0 行更新)。未传的字段不下发,避免覆盖既有值。
 *
 * 团队 ID 的唯一性口径是「(团队 ID, 主持人) 组合唯一」（见迁移 20261002000000）：
 * 同一主持人名下不能有两个相同团队 ID 的团，不同主持人之间可以重复；
 * 改后若撞上该组合，Postgres 会报 23505（teams_team_code_host_profile_id_key），
 * 由管理端页面转成可读提示。
 */
export async function updateTeam(id: string, input: { name?: string; teamCode?: string; hostProfileId?: string; status?: "active" | "disabled" }) {
  const { error } = await getBrowserSupabase()
    .from("teams")
    .update({
      name: input.name,
      team_code: input.teamCode?.trim(),
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

// ==================== 当日主播流水（外部接口经 Edge Function 代取）====================

/**
 * 上游 `/api/daily-income` 的 data 字段（由边缘函数原样透传，见 supabase/functions/daily-income）。
 * 识别主播：`rooms[].series[].aweme_display_id`（抖音号）或 `user_id`（数字 uid）
 * 对应成员资料里的 `douyin_id` —— 两者都算「抖音号」，填哪个都能匹配。
 */
export type DailyIncomePayload = {
  anchor_id: string;
  date: string;
  hasLive: boolean;
  /** 当日总直播时长（**秒**，所有直播间合计）。上游对数字字段类型不稳定，按字符串兜底。 */
  liveDuration?: number | string;
  totalIncome?: number;
  rooms?: {
    roomId: string;
    /** 当日总时长（秒）：上游把它重复下发到每个房间，聚合时不要累加。 */
    liveDuration?: number | string;
    series?: {
      /** 抖音号（如 qkl1122334）。 */
      aweme_display_id?: string;
      /** 抖音数字 uid（如 2686827281788563）。 */
      user_id?: string;
      nickname?: string;
      avatar?: string;
      income?: number | string;
      star_guard_income?: number | string;
      other_income?: number | string;
      increase_fans?: number | string;
    }[];
  }[];
};

/**
 * 拉取某团队指定日期的主播流水明细。
 * 经 daily-income Edge Function 代取：浏览器不再直连外部 http 服务（混合内容/CORS 拦截），
 * 上游地址与调用凭据也留在服务端；上游报错统一归一化为 ApiError。
 *
 * 同时下发 teamId（teams.id，uuid）与团队 ID（team_code）：团队 ID 允许重复，
 * 后端用 teamId 精确定位团队并校验可见性，团队 ID 仅作旧客户端兼容的兜底定位。
 *
 * @param date 目标日期 `YYYY-MM-DD`（由日期表单决定），透传给上游 `date` 参数。
 */
export async function fetchDailyIncomePayload(team: { teamId: string; teamCode: string }, date: string): Promise<DailyIncomePayload> {
  const body = await invokeEdgeFunction<EdgeFunctionBody<DailyIncomePayload>>("daily-income", {
    teamId: team.teamId,
    anchorId: team.teamCode,
    date,
  }, {
    fallbackMessage: "拉取流水失败",
    codeMessages: {
      UNAUTHENTICATED: "登录状态已失效，请重新登录",
      FORBIDDEN: "你不在该团队中，无法拉取流水",
      TEAM_NOT_FOUND: "团队不存在，请核对团队 ID",
      INVALID_INPUT: "请求参数有误",
      UPSTREAM_FAILED: "流水接口不可达，请稍后再试",
    },
  });

  if (!body.data) {
    throw new ApiError(ApiErrorCode.UNKNOWN, body.message ?? "流水服务未返回数据，请稍后再试", body);
  }

  return body.data;
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
  return invokeEdgeFunction<Record<string, unknown>>(name, body, {
    fallbackMessage: "操作失败",
    codeMessages: {
      FORBIDDEN: "没有操作权限",
      INVALID_INPUT: "输入不合法",
      EMAIL_TAKEN: "该邮箱已被占用",
    },
  });
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

// ==================== 主播流水结算（/admin/anchor-revenue）====================

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
  /** 当日调整项折算金额（分，可正可负）。 */
  adjustmentCents: number;
  /** 当日逐条调整项明细（名称 + 数值）；历史记录可能为空，仅能以 adjustmentCents 兜底。 */
  adjustments: AnchorRevenueAdjustment[];
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
      .select("id, team_id, profile_id, perf_date, revenue_cents, broadcast_minutes, adjustment_cents, adjustments, no_perf, no_perf_note, created_at, team:teams(name), point:performance_points(name), profile:profiles!anchor_revenue_records_profile_id_fkey(name)")
      .in("profile_id", ids).gte("perf_date", period.start).lte("perf_date", period.end)
      .order("perf_date", { ascending: false }).order("created_at", { ascending: false }).order("id")
      .range(from, to));
    rows.push(...data.map((r) => ({
      id: r.id, teamId: r.team_id, teamName: r.team?.name ?? null,
      profileId: r.profile_id, profileName: r.profile?.name ?? null,
      perfDate: r.perf_date, revenueCents: r.revenue_cents, broadcastMinutes: r.broadcast_minutes,
      pointName: r.point?.name ?? null, adjustmentCents: r.adjustment_cents,
      adjustments: parseAnchorRevenueAdjustments(r.adjustments),
      noPerf: r.no_perf, noPerfNote: r.no_perf_note, createdAt: r.created_at,
    })));
  }
  return rows.sort((a, b) => b.perfDate.localeCompare(a.perfDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
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
        serviceFeeRateBps: scheme.service_fee_rate_bps,
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
  /** 结算备注（选填），落库 salary_records.note，工资核算页展示。 */
  note?: string;
}

/**
 * 管理员手动结算主播流水：对勾选主播按周期实时聚合 + 叠加调整项，落库进四态审核流。
 *
 * 流程：拉取周期流水与成员上下文 → [`aggregateSettlement()`](lib/domain/settlement/aggregate.ts:88)
 * 得基础工资草稿 → 逐主播 [`applyAdjustments()`](lib/domain/payroll/adjustment.ts) 叠加调整项
 * 重算总工资/服务费/实发 → 组装 p_members 调 settle_anchor_revenue RPC（单事务 upsert + 日志，
 * 仅允许管理员手动写入，不再提供自动结算入口）。
 */
export async function settleAnchorRevenue(input: { teamId: string | null; period: PeriodRange; members: AnchorSettleMember[]; replaceOverlapping?: boolean }): Promise<{ settledRecords: number }> {
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

  // 仅校验已选人员在名单且有生效方案；金额一律由数据库权威重算，前端不再传任何计算结果。
  const membersByKey = new Map(input.members.map((m) => [settlementMemberKey(m), m]));

  // 组装 RPC p_members：仅身份 + 加点 + 调整项，数据库自行读流水/入职日/方案完整重算。
  const payload = contexts.map((context) => {
    const key = settlementMemberKey(context);
    const {
      attendanceBonusBps = 0,
      dyTaskBonusBps = 0,
      adjustments = [],
      note = "",
    } = membersByKey.get(key)!;
    return {
      profileId: context.profileId,
      positionId: context.positionId,
      attendanceBonusBps,
      dyTaskBonusBps,
      adjustments: adjustments.map((a) => ({ name: a.name, amountCents: a.amountCents })),
      note,
    };
  });

  const { data, error } = await retrySettlement(() => supabase.rpc("settle_anchor_revenue", {
    p_team_id: input.teamId,
    p_period_start: input.period.start,
    p_period_end: input.period.end,
    p_members: payload as unknown as Json,
    p_replace_overlapping: input.replaceOverlapping ?? false,
  }));
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ADMIN_REQUIRED") || msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权手动结算");
    if (msg.includes("TEAM_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "团队不存在");
    if (msg.includes("SALARY_SCHEME_MISSING")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "部分主播缺少生效工资方案，无法结算");
    if (msg.includes("SALARY_OVERLAP_COMPLETED")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "所选区间与已完成的工资记录重叠，无法覆盖结算");
    if (msg.includes("SALARY_RECORD_COMPLETED")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "该周期工资已「已完成」，无法重新结算");
    fail(error);
  }
  return { settledRecords: (data as number) ?? 0 };
}

// ==================== 主持工资核算（主持管理 / 主持流水 / 独立主持工资表）====================

export type HostSalarySchemeRow = Database["public"]["Tables"]["host_salary_schemes"]["Row"] & {
  profile: Pick<Profile, "name"> | null;
  position: Pick<Position, "name"> | null;
};
export type HostSalaryRecord = Database["public"]["Tables"]["host_salary_records"]["Row"] & {
  host: Pick<Profile, "name"> | null;
};
export type HostSalaryStatusLog = Database["public"]["Tables"]["host_salary_record_status_logs"]["Row"] & {
  operator: Pick<Profile, "name"> | null;
};
export type HostSalarySchemeConfig = Database["public"]["Tables"]["host_salary_schemes"]["Insert"];

/** 按团队拆分的主持周期流水明细（用于「团总流水」弹窗）。 */
export interface HostTeamBreakdown {
  teamId: string;
  teamName: string | null;
  revenueCents: number;
  broadcastMinutes: number;
}

/** 单个主持的结算上下文：跨团流水 + 团队明细 + 生效方案。 */
export interface HostSettlementContext {
  hostProfileId: string;
  hostName: string;
  schemeId: string | null;
  scheme: HostSalaryScheme | null;
  revenueCents: number;
  broadcastMinutes: number;
  teamBreakdown: HostTeamBreakdown[];
}

/** 结算入参：主持 + 调整项（违约/奖励）。 */
export interface HostSettleMember {
  hostProfileId: string;
  adjustments?: PayrollAdjustment[];
}

export async function listHostSchemes(): Promise<HostSalarySchemeRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from("host_salary_schemes")
    .select("*, profile:profiles(name), position:positions(name)")
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return data as unknown as HostSalarySchemeRow[];
}

export async function createHostScheme(input: HostSalarySchemeConfig) {
  const { error } = await getBrowserSupabase().from("host_salary_schemes").insert(input);
  if (error) fail(error);
}

export async function listHostSalaryRecords(): Promise<HostSalaryRecord[]> {
  const { data, error } = await getBrowserSupabase()
    .from("host_salary_records")
    .select("*, host:profiles!host_salary_records_host_profile_id_fkey(name)")
    .order("month", { ascending: false });
  if (error) fail(error);
  return data as unknown as HostSalaryRecord[];
}

/**
 * 主持结算上下文：主持岗位成员 ∪ 周期内出现过的录入主持，
 * 跨团队汇总团总流水/直播时长，并给出团队明细分项与生效主持方案。
 */
export async function getHostSettlementContexts(period: PeriodRange): Promise<HostSettlementContext[]> {
  const supabase = getBrowserSupabase();

  // 主持岗位成员。
  const positionRows = await readSettlementRows((from, to) => supabase
    .from("user_positions")
    .select("profile_id, position:positions!inner(code), profile:profiles!inner(name)")
    .eq("position.code", "host")
    .order("profile_id").order("position_id").range(from, to));
  const hostIds = new Set(positionRows.map((r) => r.profile_id));
  const names: Record<string, string> = {};
  for (const row of positionRows) names[row.profile_id] = row.profile.name;

  // 周期内所有录入主持的流水，按 主持 × 团队 聚合。
  // 直播时长口径：接口返回的是「团队当日总直播时长」，上传时写入当天每个匹配主播
  //（同一团队同一天各成员值相同），故按 (团队, 日期) 取 MAX 去重后再汇总，不能被成员数放大。
  interface TeamAgg {
    teamId: string;
    teamName: string | null;
    revenueCents: number;
    dailyBroadcast: Map<string, number>;
  }
  const revenueRows = await readSettlementRows((from, to) => supabase
    .from("anchor_revenue_records")
    .select("host_profile_id, team_id, perf_date, revenue_cents, broadcast_minutes, no_perf, team:teams(name)")
    .not("host_profile_id", "is", null)
    .gte("perf_date", period.start).lte("perf_date", period.end)
    .order("id").range(from, to));

  const breakdownByHost = new Map<string, Map<string, TeamAgg>>();
  for (const row of revenueRows) {
    const hostId = row.host_profile_id;
    if (!hostId) continue;
    hostIds.add(hostId);
    const byTeam = breakdownByHost.get(hostId) ?? new Map<string, TeamAgg>();
    const item = byTeam.get(row.team_id) ?? {
      teamId: row.team_id,
      teamName: row.team?.name ?? null,
      revenueCents: 0,
      dailyBroadcast: new Map<string, number>(),
    };
    if (!row.no_perf) item.revenueCents += row.revenue_cents;
    item.dailyBroadcast.set(
      row.perf_date,
      Math.max(item.dailyBroadcast.get(row.perf_date) ?? 0, row.broadcast_minutes),
    );
    byTeam.set(row.team_id, item);
    breakdownByHost.set(hostId, byTeam);
  }

  // 补全仅出现在流水中的主持姓名。
  const missing = [...hostIds].filter((id) => !names[id]);
  for (let i = 0; i < missing.length; i += 100) {
    const ids = missing.slice(i, i + 100);
    const { data, error } = await supabase.from("profiles").select("id, name").in("id", ids);
    if (error) fail(error);
    for (const row of data) names[row.id] = row.name;
  }

  // 生效方案：个人优先，其次模板。
  const schemes = await readSettlementRows((from, to) => supabase
    .from("host_salary_schemes")
    .select("*").eq("status", "active").lte("effective_from", period.end)
    .order("effective_from", { ascending: false }).order("version", { ascending: false }).order("id")
    .range(from, to));
  const personal = new Map<string, typeof schemes[number]>();
  let template: typeof schemes[number] | undefined;
  for (const scheme of schemes) {
    if (scheme.profile_id === null) {
      template ??= scheme;
    } else if (!personal.has(scheme.profile_id)) {
      personal.set(scheme.profile_id, scheme);
    }
  }

  return [...hostIds].map((hostId) => {
    const breakdown: HostTeamBreakdown[] = [...(breakdownByHost.get(hostId)?.values() ?? [])]
      .map((item) => ({
        teamId: item.teamId,
        teamName: item.teamName,
        revenueCents: item.revenueCents,
        broadcastMinutes: [...item.dailyBroadcast.values()].reduce((sum, value) => sum + value, 0),
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents || (a.teamName ?? "").localeCompare(b.teamName ?? "", "zh-CN"));
    const scheme = personal.get(hostId) ?? template;
    return {
      hostProfileId: hostId,
      hostName: names[hostId] ?? "—",
      schemeId: scheme?.id ?? null,
      scheme: scheme
        ? {
            baseIncomeInCents: scheme.base_income_cents,
            commissionStartInCents: scheme.commission_start_cents,
            baseCommissionRateBps: scheme.base_commission_rate_bps,
            serviceFeeRateBps: scheme.service_fee_rate_bps,
          }
        : null,
      revenueCents: breakdown.reduce((sum, item) => sum + item.revenueCents, 0),
      broadcastMinutes: breakdown.reduce((sum, item) => sum + item.broadcastMinutes, 0),
      teamBreakdown: breakdown,
    };
  }).sort((a, b) => b.revenueCents - a.revenueCents || a.hostName.localeCompare(b.hostName, "zh-CN"));
}

/**
 * 管理员手动结算主持工资：仅传主持身份 + 调整项，数据库按周期流水与方案权威重算，
 * 写入独立主持工资表并进入四态审核流。
 */
export async function settleHostPayroll(input: { period: PeriodRange; hosts: HostSettleMember[]; replaceOverlapping?: boolean }): Promise<{ settledRecords: number }> {
  if (!input.hosts.length) throw new ApiError(ApiErrorCode.INVALID_INPUT, "请至少勾选一位主持");
  const unique = new Set(input.hosts.map((h) => h.hostProfileId));
  if (unique.size !== input.hosts.length) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "同一主持不能重复结算");
  }
  const supabase = getBrowserSupabase();
  const payload = input.hosts.map((host) => ({
    hostProfileId: host.hostProfileId,
    adjustments: (host.adjustments ?? []).map((a) => ({ name: a.name, amountCents: a.amountCents })),
  }));
  const { data, error } = await retrySettlement(() => supabase.rpc("settle_host_payroll", {
    p_period_start: input.period.start,
    p_period_end: input.period.end,
    p_hosts: payload as unknown as Json,
    p_replace_overlapping: input.replaceOverlapping ?? false,
  }));
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ADMIN_REQUIRED") || msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权手动结算");
    if (msg.includes("HOST_SALARY_SCHEME_MISSING")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "部分主持缺少生效工资方案，无法结算");
    if (msg.includes("HOST_SALARY_OVERLAP_COMPLETED")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "所选区间与已完成的主持工资记录重叠，无法覆盖结算");
    if (msg.includes("HOST_SALARY_RECORD_NOT_PENDING_REVIEW")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "主持工资已进入审核后续流程，不能覆盖");
    fail(error);
  }
  return { settledRecords: (data as number) ?? 0 };
}

export async function transitionHostSalaryStatus(
  id: string,
  toStatus: SalaryRecordStatus,
  options?: { operatorProfileId?: string; note?: string },
): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.rpc("transition_host_salary_status", {
    p_id: id,
    p_to_status: toStatus,
    p_operator_profile_id: options?.operatorProfileId ?? null,
    p_note: options?.note ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("HOST_SALARY_RECORD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "主持工资记录不存在");
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权执行该状态流转");
    if (msg.includes("INVALID_TRANSITION")) throw new ApiError(ApiErrorCode.INVALID_INPUT, `不允许流转到「${toStatus}」`);
    fail(error);
  }
}

export async function rejectAndRecomputeHostSalary(id: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await retrySettlement(() => supabase.rpc("recompute_host_salary_record", {
    p_id: id,
    p_note: "管理员驳回，已按保存周期跨团流水由数据库权威重算并保留原调整项",
  }));
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("HOST_SALARY_RECORD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "主持工资记录不存在");
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权驳回重算");
    if (msg.includes("INVALID_TRANSITION")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "仅待审核主持工资条可驳回重算");
    if (msg.includes("HOST_SALARY_SCHEME_MISSING")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "该主持无周期内生效工资方案，无法重算");
    fail(error);
  }
}

export async function listHostSalaryStatusLogs(salaryRecordId: string): Promise<HostSalaryStatusLog[]> {
  const { data, error } = await getBrowserSupabase()
    .from("host_salary_record_status_logs")
    .select("*, operator:profiles!host_salary_record_status_logs_operator_profile_id_fkey(name)")
    .eq("salary_record_id", salaryRecordId)
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return data as unknown as HostSalaryStatusLog[];
}

// ==================== 固定薪资工资条（化妆师/舞蹈老师/行政/运镜/人事）+ 主播延误记录 ====================

export type StaffSalaryRecord = Database["public"]["Tables"]["staff_salary_records"]["Row"] & {
  profile: Pick<Profile, "name"> | null;
  position: Pick<Position, "code" | "name"> | null;
};
export type StaffSalaryStatusLog = Database["public"]["Tables"]["staff_salary_record_status_logs"]["Row"] & {
  operator: Pick<Profile, "name"> | null;
};

/** 新增固定薪资工资条的单项入参（金额单位：分）。 */
export interface StaffSalaryCreateItem {
  profileId: string;
  positionId: number;
  /** 总违约（≤0）。 */
  penaltyCents: number;
  /** 总奖励（≥0）。 */
  rewardCents: number;
  /** 个税（≥0）：管理员手动输入。 */
  taxCents: number;
  note?: string;
}

/** 固定薪资工资条（管理员看全部；成员本人只看非待审核记录，由 RLS 决定）。 */
export async function listStaffSalaryRecords(): Promise<StaffSalaryRecord[]> {
  const { data, error } = await getBrowserSupabase()
    .from("staff_salary_records")
    .select("*, profile:profiles!staff_salary_records_profile_id_fkey(name), position:positions(code, name)")
    .order("month", { ascending: false });
  if (error) fail(error);
  return data as unknown as StaffSalaryRecord[];
}

/**
 * 管理员新增/覆盖固定薪资工资条：仅传成员 + 职位 + 总违约 + 总奖励 + 个税，
 * 基础薪资由数据库按职位从 profiles 对应列快照并权威计算合计与到手。
 */
export async function createStaffSalaryRecords(input: {
  period: PeriodRange;
  records: StaffSalaryCreateItem[];
}): Promise<{ settledRecords: number }> {
  if (!input.records.length) throw new ApiError(ApiErrorCode.INVALID_INPUT, "请至少选择一位成员");
  const keys = new Set(input.records.map((record) => `${record.profileId}:${record.positionId}`));
  if (keys.size !== input.records.length) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "同一成员同一职位不能重复新增记录");
  }
  const supabase = getBrowserSupabase();
  const { data, error } = await retrySettlement(() => supabase.rpc("create_staff_salary_records", {
    p_period_start: input.period.start,
    p_period_end: input.period.end,
    p_records: input.records.map((record) => ({
      profileId: record.profileId,
      positionId: record.positionId,
      penaltyCents: record.penaltyCents,
      rewardCents: record.rewardCents,
      taxCents: record.taxCents,
      note: record.note ?? "",
    })) as unknown as Json,
  }));
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ADMIN_REQUIRED") || msg.includes("FORBIDDEN")) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, "无权新增工资条");
    }
    if (
      msg.includes("INVALID_STAFF_POSITION") ||
      msg.includes("MEMBER_POSITION_MISMATCH") ||
      msg.includes("UNSUPPORTED_POSITION")
    ) {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "所选成员或职位不支持该工资条");
    }
    if (msg.includes("SALARY_RECORD_NOT_PENDING_REVIEW")) {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "该成员所选周期的记录已进入审核后续流程，不能覆盖");
    }
    if (msg.includes("INVALID_SALARY_ADJUSTMENTS")) {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "总违约须不大于 0 元，总奖励须不小于 0 元");
    }
    fail(error);
  }
  return { settledRecords: (data as number) ?? 0 };
}

/** 固定薪资工资条四态流转。 */
export async function transitionStaffSalaryStatus(
  id: string,
  toStatus: SalaryRecordStatus,
  options?: { operatorProfileId?: string; note?: string },
): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.rpc("transition_staff_salary_status", {
    p_id: id,
    p_to_status: toStatus,
    p_operator_profile_id: options?.operatorProfileId ?? null,
    p_note: options?.note ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("STAFF_SALARY_RECORD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "工资条记录不存在");
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权执行该状态流转");
    if (msg.includes("INVALID_TRANSITION")) throw new ApiError(ApiErrorCode.INVALID_INPUT, `不允许流转到「${toStatus}」`);
    fail(error);
  }
}

/** 驳回重算：重算合计与个税，重置为待审核。 */
export async function rejectAndRecomputeStaffSalary(id: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await retrySettlement(() => supabase.rpc("recompute_staff_salary_record", {
    p_id: id,
    p_note: "管理员驳回，已重新计算工资条",
  }));
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("STAFF_SALARY_RECORD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "工资条记录不存在");
    if (msg.includes("FORBIDDEN_TRANSITION")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权驳回重算");
    if (msg.includes("INVALID_TRANSITION")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "仅待审核记录可驳回重算");
    fail(error);
  }
}

export async function listStaffSalaryStatusLogs(salaryRecordId: string): Promise<StaffSalaryStatusLog[]> {
  const { data, error } = await getBrowserSupabase()
    .from("staff_salary_record_status_logs")
    .select("*, operator:profiles!staff_salary_record_status_logs_operator_profile_id_fkey(name)")
    .eq("salary_record_id", salaryRecordId)
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return data as unknown as StaffSalaryStatusLog[];
}

/** 管理员设置某成员某职位的基础薪资（写 profiles 对应职位列）。 */
export async function setStaffBaseIncome(input: {
  profileId: string;
  positionCode: string;
  baseIncomeInCents: number;
}): Promise<void> {
  if (!Number.isInteger(input.baseIncomeInCents) || input.baseIncomeInCents < 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础薪资须为不小于 0 的金额");
  }
  const { error } = await getBrowserSupabase().rpc("set_staff_base_income", {
    p_profile_id: input.profileId,
    p_position_code: input.positionCode,
    p_cents: input.baseIncomeInCents,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ADMIN_REQUIRED") || msg.includes("FORBIDDEN")) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, "无权设置基础薪资");
    }
    if (msg.includes("UNSUPPORTED_POSITION")) {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "该职位不支持设置基础薪资");
    }
    fail(error);
  }
}

/** 主播延误记录（含主播名 / 登记化妆师名）。 */
export interface AnchorDelayRow {
  id: string;
  anchorProfileId: string;
  anchorName: string;
  delayDate: string;
  isDelayed: boolean;
  registeredBy: string | null;
  registeredName: string | null;
  note: string | null;
  updatedAt: string;
}

/** 全部在职主播（供化妆师标记延误时搜索多选）。 */
export async function listAnchorMembers(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await getBrowserSupabase().rpc("list_anchor_members");
  if (error) fail(error);
  return (data ?? []) as { id: string; name: string }[];
}

/** 查询延误记录；不传区间返回全部（页面自行取最新日期）。 */
export async function listAnchorDelays(range?: { start?: string; end?: string }): Promise<AnchorDelayRow[]> {
  const { data, error } = await getBrowserSupabase().rpc("list_anchor_delays", {
    p_start: range?.start ?? null,
    p_end: range?.end ?? null,
  });
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    anchorProfileId: row.anchor_profile_id,
    anchorName: row.anchor_name,
    delayDate: row.delay_date,
    isDelayed: row.is_delayed,
    registeredBy: row.registered_by,
    registeredName: row.registered_name,
    note: row.note,
    updatedAt: row.updated_at,
  }));
}

/** 批量设置延误状态（唯一键 upsert，后改覆盖登记人）；备注可为空。 */
export async function setAnchorDelays(input: {
  date: string;
  anchorIds: string[];
  isDelayed: boolean;
  note?: string;
}): Promise<number> {
  const { data, error } = await getBrowserSupabase().rpc("set_anchor_delays", {
    p_delay_date: input.date,
    p_anchor_ids: input.anchorIds,
    p_is_delayed: input.isDelayed,
    p_note: input.note ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("FORBIDDEN")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权设置延误");
    fail(error);
  }
  return (data as number) ?? 0;
}

/** 主播奖励项记录（含主播名 / 登记舞蹈老师名）。 */
export interface AnchorRewardRow {
  id: string;
  anchorProfileId: string;
  anchorName: string;
  rewardDate: string;
  name: string;
  amountCents: number;
  registeredBy: string | null;
  registeredName: string | null;
  note: string | null;
  updatedAt: string;
}

/** 查询奖励记录；不传区间返回全部（页面自行取最新日期）。 */
export async function listAnchorRewards(range?: { start?: string; end?: string }): Promise<AnchorRewardRow[]> {
  const { data, error } = await getBrowserSupabase().rpc("list_anchor_rewards", {
    p_start: range?.start ?? null,
    p_end: range?.end ?? null,
  });
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    anchorProfileId: row.anchor_profile_id,
    anchorName: row.anchor_name,
    rewardDate: row.reward_date,
    name: row.name,
    amountCents: row.amount_cents,
    registeredBy: row.registered_by,
    registeredName: row.registered_name,
    note: row.note,
    updatedAt: row.updated_at,
  }));
}

/** 批量设置奖励（同主播+日期+名称 upsert）；金额为整数分且 > 0。 */
export async function setAnchorRewards(input: {
  date: string;
  anchorIds: string[];
  name: string;
  amountCents: number;
  note?: string;
}): Promise<number> {
  const { data, error } = await getBrowserSupabase().rpc("set_anchor_rewards", {
    p_reward_date: input.date,
    p_anchor_ids: input.anchorIds,
    p_name: input.name,
    p_amount_cents: input.amountCents,
    p_note: input.note ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("FORBIDDEN")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权设置奖励");
    if (msg.includes("INVALID_REWARD_NAME")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "奖励名称需为 1-50 个字符");
    if (msg.includes("INVALID_REWARD_AMOUNT")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "奖励金额需大于 0 且不超过 100 万元");
    if (msg.includes("INVALID_REWARD_DATE")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "奖励日期无效");
    fail(error);
  }
  return (data as number) ?? 0;
}

/** 编辑单条奖励（名称/金额/备注）。 */
export async function updateAnchorReward(input: {
  id: string;
  name: string;
  amountCents: number;
  note?: string;
}): Promise<void> {
  const { error } = await getBrowserSupabase().rpc("update_anchor_reward", {
    p_id: input.id,
    p_name: input.name,
    p_amount_cents: input.amountCents,
    p_note: input.note ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("FORBIDDEN")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权修改奖励");
    if (msg.includes("REWARD_NAME_CONFLICT")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "该主播当天已存在同名奖励");
    if (msg.includes("REWARD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "奖励记录不存在");
    if (msg.includes("INVALID_REWARD_NAME")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "奖励名称需为 1-50 个字符");
    if (msg.includes("INVALID_REWARD_AMOUNT")) throw new ApiError(ApiErrorCode.INVALID_INPUT, "奖励金额需大于 0 且不超过 100 万元");
    fail(error);
  }
}

/** 删除单条奖励。 */
export async function deleteAnchorReward(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc("delete_anchor_reward", { p_id: id });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("FORBIDDEN")) throw new ApiError(ApiErrorCode.FORBIDDEN, "无权删除奖励");
    if (msg.includes("REWARD_NOT_FOUND")) throw new ApiError(ApiErrorCode.NOT_FOUND, "奖励记录不存在");
    fail(error);
  }
}

/** 把奖励记录按主播聚合为调整项（正数，携带登记日期/登记人留痕）。 */
export function rewardAdjustmentsByProfile(rows: AnchorRewardRow[]): Record<string, PayrollAdjustment[]> {
  const map: Record<string, PayrollAdjustment[]> = {};
  for (const row of rows) {
    (map[row.anchorProfileId] ??= []).push({
      name: row.name,
      amountCents: row.amountCents,
      sourceDate: row.rewardDate,
      sourceOperator: row.registeredName ?? undefined,
    });
  }
  return map;
}

