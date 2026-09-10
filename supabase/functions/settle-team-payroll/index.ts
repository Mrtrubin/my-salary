import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type SettlementType,
  getPeriodRange,
  isPeriodFirstDay,
  nextDay,
} from "./cycle.ts";
import { computePayroll, type PayrollScheme } from "./payroll.ts";

/**
 * 自动结算 Edge Function（PLAN-001 阶段3，service_role 运行，绕过 RLS）。
 *
 * 两种触发：
 *  1. pg_cron 每日 00:05 无参调用：扫描「当日 = 某团队周期第一天」且尚未结算该周期的团队，
 *     对刚结束的上一周期结算，批量生成 salary_records(status=pending_review)。
 *  2. 管理员「立即结算」带 { teamId, asOfDate? } 调用：对指定团队按 asOfDate（默认今日）
 *     所对应的上一周期立即结算（幂等：已结算同一周期则跳过）。
 *
 * 结算动作（每团队）：
 *  - 取上一周期 [start,end]
 *  - 聚合周期内 anchor_revenue_records.revenue_cents（按成员）
 *  - 对当前团队成员逐一 computePayroll → upsert salary_records
 *  - 写 salary_record_status_logs(to=pending_review)
 *  - 更新 teams.last_settled_period_end = 周期末日（幂等去重）
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface TeamRow {
  id: string;
  settlement_type: SettlementType;
  settlement_start_day: number;
  last_settled_period_end: string | null;
}

interface MemberScheme {
  profileId: string;
  positionId: number;
  schemeId: string | null;
  scheme: PayrollScheme;
  hireDate: string;
}

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient>;

/** 计算在职月序（与 aggregate.calcTenureMonth 同口径）。 */
function calcTenureMonth(hireDate: string, periodEnd: string): number {
  const [hy, hm] = hireDate.split("-").map(Number);
  const [ey, em] = periodEnd.split("-").map(Number);
  const diff = (ey - hy) * 12 + (em - hm);
  return diff < 0 ? 1 : diff + 1;
}

/** 取团队在指定周期内「在组」的成员及其对该周期生效的工资方案。 */
async function loadMembers(
  db: Db,
  teamId: string,
  periodStart: string,
  periodEnd: string,
): Promise<MemberScheme[]> {
  // 在组区间与结算周期有交集：joined_at <= periodEnd 且 (left_at 为空 或 left_at >= periodStart)。
  const { data: members, error } = await db
    .from("team_members")
    .select("profile_id, joined_at, left_at, profiles(hire_date)")
    .eq("team_id", teamId)
    .lte("joined_at", periodEnd)
    .or(`left_at.is.null,left_at.gte.${periodStart}`);
  if (error) throw new Error(`加载团队成员失败：${error.message}`);

  const result: MemberScheme[] = [];
  for (const m of members ?? []) {
    // deno-lint-ignore no-explicit-any
    const row = m as any;
    const profileId = row.profile_id as string;
    const hireDate = row.profiles?.hire_date as string | undefined;
    if (!hireDate) continue;

    // 成员岗位列表：每个岗位一套方案（个人方案优先，否则回退岗位模板）。
    const { data: positions } = await db
      .from("user_positions")
      .select("position_id")
      .eq("profile_id", profileId);
    const positionIds = (positions ?? [])
      .map((p) => (p as { position_id: number }).position_id)
      .filter((id): id is number => typeof id === "number");

    for (const positionId of positionIds) {
      const scheme = await resolveScheme(db, profileId, positionId, periodEnd);
      if (!scheme) continue; // 该岗位无个人方案也无模板，不结算。
      result.push({
        profileId,
        positionId,
        schemeId: scheme.id as string,
        scheme: {
          baseSalaryInCents: scheme.base_salary_cents as number,
          guaranteedSalaryInCents: scheme.guaranteed_salary_cents as number,
          thresholdMultiplierBps: scheme.threshold_multiplier_bps as number,
        },
        hireDate,
      });
    }
  }
  return result;
}

/**
 * 解析某成员某岗位在结算周期内生效的工资方案：
 *  1. 个人方案优先：profile_id 精确匹配该成员且 position_id 匹配该岗位；
 *  2. 无个人方案时回退「岗位模板」：profile_id 为空（作为该岗位共享默认）且 position_id 匹配。
 * 均要求 status=active 且 effective_from <= periodEnd，取 effective_from 最新一条。
 */
async function resolveScheme(
  db: Db,
  profileId: string,
  positionId: number,
  periodEnd: string,
): Promise<(Record<string, unknown> & { id: string }) | null> {
  const selectCols =
    "id, position_id, base_salary_cents, guaranteed_salary_cents, threshold_multiplier_bps";
  const baseQuery = () =>
    db
      .from("salary_schemes")
      .select(selectCols)
      .eq("position_id", positionId)
      .eq("status", "active")
      .lte("effective_from", periodEnd)
      .order("effective_from", { ascending: false })
      .limit(1);

  const { data: personal } = await baseQuery()
    .eq("profile_id", profileId)
    .maybeSingle();
  if (personal) return personal as Record<string, unknown> & { id: string };

  const { data: template } = await baseQuery().is("profile_id", null).maybeSingle();
  return (template as Record<string, unknown> & { id: string }) ?? null;
}

/** 聚合周期内 approved 流水（按成员）。 */
async function loadRevenue(
  db: Db,
  teamId: string,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("anchor_revenue_records")
    .select("profile_id, perf_date, revenue_cents, created_at")
    .eq("team_id", teamId)
    .gte("perf_date", start)
    .lte("perf_date", end);
  if (error) throw new Error(`加载团队流水失败：${error.message}`);
  // 唯一约束 (team_id, perf_date, profile_id) 保证同日单条；此处按 created_at 取最新做历史数据兜底，
  // 避免约束生效前的历史重复记录被重复计入导致金额翻倍。
  const latest = new Map<string, { profileId: string; revenueCents: number; createdAt: string }>();
  for (const r of data ?? []) {
    // deno-lint-ignore no-explicit-any
    const row = r as any;
    const key = `${row.profile_id}__${row.perf_date}`;
    const createdAt = (row.created_at ?? "") as string;
    const prev = latest.get(key);
    if (!prev || createdAt > prev.createdAt) {
      latest.set(key, { profileId: row.profile_id, revenueCents: row.revenue_cents ?? 0, createdAt });
    }
  }
  const map = new Map<string, number>();
  for (const row of latest.values()) {
    map.set(row.profileId, (map.get(row.profileId) ?? 0) + row.revenueCents);
  }
  return map;
}

/**
 * 查询「上月」各成员各岗位是否达标，用于决定本月保底基准（初始/降级）。
 * 上月的判定：该团队、该成员、该岗位、period_end 落在 period.start 之前的最近一条
 * salary_records.is_qualified。无上月记录时视为达标（沿用初始保底，保底优先，不误伤）。
 */
async function loadLastMonthQualified(
  db: Db,
  teamId: string,
  periodStart: string,
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  const { data, error } = await db
    .from("salary_records")
    .select("profile_id, position_id, is_qualified, period_end")
    .eq("team_id", teamId)
    .lt("period_end", periodStart)
    .order("period_end", { ascending: false });
  if (error) throw new Error(`加载上月达标状态失败：${error.message}`);

  const seen = new Set<string>();
  for (const r of (data ?? []) as { profile_id: string; position_id: number; is_qualified: boolean }[]) {
    const key = `${r.profile_id}:${r.position_id}`;
    // 按 period_end 降序，首见即最近一条上月记录。
    if (seen.has(key)) continue;
    seen.add(key);
    map.set(key, r.is_qualified);
  }
  return map;
}

/** 某成员结算上下文（含在组区间过滤后的成员）重用于单周期结算。 */
interface PeriodSettlement {
  period: { start: string; end: string };
  /** 是否为已结算周期的重算（force=true 绕过 RPC 防倒退短路）。 */
  force: boolean;
}

/**
 * 枚举团队所有「需要结算/重算」的周期，按时间正序返回。
 *
 * 范围起点：上次结算游标之后（last_settled_period_end 的次日），或团队最早一笔已批准流水日期（兜底）；
 * 范围终点：asOf 当日所在周期（含）。
 *
 * 每周期是否需结算的判定：
 *  - 该团队+周期内无任何 salary_record → 需结算（force=false，新建）；
 *  - 存在 salary_record 但均为「未锁定」状态(pending_review/pending_confirm)，
 *    且周期内业绩的最新 updated_at 晚于工资记录的最新 updated_at（业绩补提/修正）→ 需重算（force=true）；
 *  - 存在已确认/已完成(confirmed/completed)的记录 → 锁定，跳过。
 */
async function listPeriodsToSettle(
  db: Db,
  team: TeamRow,
  asOf: string,
): Promise<PeriodSettlement[]> {
  const periodRanges: { start: string; end: string }[] = [];

  // 起点：优先从游标次日开始；否则取团队最早一笔 approved 流水日期（兜底避免全历史扫描）。
  let seed: string | null = team.last_settled_period_end
    ? nextDay(team.last_settled_period_end)
    : null;
  if (!seed) {
    const { data: earliest } = await db
      .from("anchor_revenue_records")
      .select("perf_date")
      .eq("team_id", team.id)
      .order("perf_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    seed = earliest?.perf_date ?? asOf;
  }

  // 从 seed 所在周期起，逐周期推进，但只结算「已完全结束」的周期（period.end < asOf）。
  // 当前进行中的周期（period.end >= asOf）尚未收尾，不得结算，也不得推进游标到未来。
  let cursor = seed;
  for (let i = 0; i < 1200; i += 1) {
    const range = getPeriodRange(team.settlement_type, team.settlement_start_day, cursor);
    if (range.end >= asOf) break;
    periodRanges.push({ start: range.start, end: range.end });
    cursor = nextDay(range.end);
  }

  const result: PeriodSettlement[] = [];
  for (const period of periodRanges) {
    // 1. 该周期内工资记录概览（是否锁定）。
    const { data: records, error: recErr } = await db
      .from("salary_records")
      .select("status, updated_at")
      .eq("team_id", team.id)
      .gte("period_start", period.start)
      .lte("period_end", period.end);
    if (recErr) throw new Error(`读取团队 ${team.id} 周期工资记录失败：${recErr.message}`);

    const rows = (records ?? []) as { status: string; updated_at: string | null }[];
    if (rows.length === 0) {
      result.push({ period, force: false });
      continue;
    }

    // 存在终态（confirmed/completed）→ 锁定，不在手动 recheck 中重算。
    if (rows.some((r) => r.status === "confirmed" || r.status === "completed")) {
      continue;
    }

    // 2. 业绩变更检测：周期内业绩最新 updated_at > 工资记录最新 updated_at。
    const { data: perfLatest } = await db
      .from("anchor_revenue_records")
      .select("updated_at")
      .eq("team_id", team.id)
      .gte("perf_date", period.start)
      .lte("perf_date", period.end)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const salaryLatestMs = Math.max(
      ...rows.map((r) => (r.updated_at ? new Date(r.updated_at).getTime() : 0)),
      0,
    );
    const perfLatestMs = perfLatest?.updated_at
      ? new Date(perfLatest.updated_at).getTime()
      : 0;

    if (perfLatestMs > salaryLatestMs) {
      result.push({ period, force: true });
    }
  }

  return result;
}

/** 对单个团队单个周期结算（新建或 force 重算）。返回生成/更新的记录数。 */
async function settlePeriod(
  db: Db,
  team: TeamRow,
  period: { start: string; end: string },
  force: boolean,
): Promise<number> {
  const members = await loadMembers(db, team.id, period.start, period.end);
  const revenueMap = members.length
    ? await loadRevenue(db, team.id, period.start, period.end)
    : new Map<string, number>();
  const lastMonthMap = members.length
    ? await loadLastMonthQualified(db, team.id, period.start)
    : new Map<string, boolean>();

  // 库外计算（与 TS 领域口径一致），组装每个成员的结果，交由 RPC 在单事务内落库。
  const payloadMembers = members.map((member) => {
    const revenueCents = revenueMap.get(member.profileId) ?? 0;
    const tenureMonth = calcTenureMonth(member.hireDate, period.end);
    const lastMonthQualified = lastMonthMap.get(`${member.profileId}:${member.positionId}`) ?? true;
    const p = computePayroll({
      scheme: member.scheme,
      monthlyRevenueInCents: revenueCents,
      tenureMonth,
      lastMonthQualified,
    });
    return {
      profileId: member.profileId,
      positionId: member.positionId,
      schemeId: member.schemeId,
      revenueCents,
      tenureMonth,
      baseGuaranteeCents: p.baseGuaranteeInCents,
      thresholdCents: p.thresholdInCents,
      commissionStartCents: p.commissionStartInCents,
      commissionRateBps: p.commissionRateBps,
      isQualified: p.isQualified,
      isGracePeriod: p.isGracefulPeriod,
      guaranteedComponentCents: p.guaranteedComponentInCents,
      performanceComponentCents: p.performanceComponentInCents,
      grossCents: p.grossSalaryInCents,
      serviceFeeCents: p.serviceFeeInCents,
      netCents: p.netSalaryInCents,
    };
  });

  // 事务原子性 + 并发行锁：批量 upsert（业务唯一键）、新建记录写日志、推进游标，
  // 全部在 settle_team_period 单事务内完成；失败整体回滚，游标不推进，下次重试。
  // force=true 时允许对已结算周期重算（金额覆盖），游标仅向前推进不回退。
  const { data: count, error: rpcErr } = await db.rpc("settle_team_period", {
    p_team_id: team.id,
    p_period_start: period.start,
    p_period_end: period.end,
    p_members: payloadMembers,
    p_force: force,
  });
  if (rpcErr) {
    throw new Error(`团队 ${team.id} 周期 ${period.start}~${period.end} 结算落库失败：${rpcErr.message}`);
  }
  return (count as number) ?? 0;
}

/**
 * 校验调用者身份，返回校验结果。
 * - cron 全量扫描：需携带 `x-cron-secret` 且与 SETTLE_CRON_SECRET 一致（service_role 内部调用）。
 * - 管理员「立即结算」：需携带用户 JWT（Authorization: Bearer <token>），且该用户为 system_role=admin。
 * service_role 会绕过 RLS，因此入口鉴权是唯一防线，绝不可缺省放行。
 */
async function authorize(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<{ ok: true; isCron: boolean; isAdmin: boolean } | { ok: false; status: number; message: string }> {
  const cronSecret = Deno.env.get("SETTLE_CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (cronSecret && providedCron && providedCron === cronSecret) {
    return { ok: true, isCron: true, isAdmin: true };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, message: "缺少身份凭证" };
  }

  // 用调用者 JWT 校验用户，再查 profiles 判定是否管理员。
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, message: "无效的身份凭证" };
  }
  const { data: profile, error: profileErr } = await userClient
    .from("profiles")
    .select("system_role")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (profileErr || (profile as { system_role?: string } | null)?.system_role !== "admin") {
    return { ok: false, status: 403, message: "仅管理员可触发结算" };
  }
  return { ok: true, isCron: false, isAdmin: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("no content", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const auth = await authorize(req, supabaseUrl, anonKey);
  if (!auth.ok) {
    return json({ code: "UNAUTHORIZED", message: auth.message }, auth.status);
  }

  const db = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let teamId: string | undefined;
  let asOfDate: string | undefined;
  try {
    const body = await req.json();
    teamId = body?.teamId;
    asOfDate = body?.asOfDate;
  } catch {
    // 无 body 视为 cron 全量扫描。
  }

  const asOf = asOfDate ?? todayISO();

  const query = db
    .from("teams")
    .select(
      "id, settlement_type, settlement_start_day, last_settled_period_end",
    )
    .eq("status", "active");
  if (teamId) query.eq("id", teamId);
  const { data: teams, error } = await query;
  if (error) return json({ code: "UNKNOWN", message: error.message }, 500);

  let settledTeams = 0;
  let settledRecords = 0;
  const failedTeams: { teamId: string; error: string }[] = [];
  for (const t of (teams ?? []) as TeamRow[]) {
    // cron 全量扫描：仅在「当日 = 该团队周期第一天」时处理（随自然结算节奏推进）。
    // 管理员手动全量核算（带或不带 teamId）：不受周期第一天限制，recheck 所有未结算/需重算周期。
    if (auth.isCron && !teamId && !isPeriodFirstDay(t.settlement_type, t.settlement_start_day, asOf)) {
      continue;
    }
    try {
      const periods = await listPeriodsToSettle(db, t, asOf);
      for (const p of periods) {
        const n = await settlePeriod(db, t, p.period, p.force);
        if (n > 0) settledTeams += 1;
        settledRecords += n;
      }
    } catch (e) {
      // 单团队失败不阻断其余团队；该团队未推进周期，下次触发会重试。
      failedTeams.push({ teamId: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    code: failedTeams.length > 0 ? "PARTIAL" : "OK",
    message: failedTeams.length > 0 ? "核算部分完成，存在失败团队" : "核算完成",
    asOf,
    settledTeams,
    settledRecords,
    failedTeams,
  }, failedTeams.length > 0 ? 207 : 200);
});