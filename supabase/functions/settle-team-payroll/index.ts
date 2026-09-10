import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type SettlementType,
  getPreviousPeriodRange,
  isPeriodFirstDay,
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
 *  - 聚合周期内 approved 的 team_performance_records.revenue_cents（按成员）
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
  commissionRateBps: number;
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
    // 取该成员在本周期生效（effective_from <= periodEnd）且 active、effective_from 最新的方案。
    const { data: scheme } = await db
      .from("salary_schemes")
      .select(
        "id, position_id, base_salary_cents, guaranteed_salary_cents, threshold_multiplier_bps, commission_rate_bps",
      )
      .eq("profile_id", profileId)
      .eq("status", "active")
      .lte("effective_from", periodEnd)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!scheme) continue; // 无方案不结算。
    result.push({
      profileId,
      positionId: scheme.position_id as number,
      schemeId: scheme.id as string,
      scheme: {
        baseSalaryInCents: scheme.base_salary_cents as number,
        guaranteedSalaryInCents: scheme.guaranteed_salary_cents as number,
        thresholdMultiplierBps: scheme.threshold_multiplier_bps as number,
        commissionRateBps: scheme.commission_rate_bps as number,
      },
      commissionRateBps: scheme.commission_rate_bps as number,
      hireDate,
    });
  }
  return result;
}

/** 聚合周期内 approved 流水（按成员）。 */
async function loadRevenue(
  db: Db,
  teamId: string,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("team_performance_records")
    .select("profile_id, revenue_cents")
    .eq("team_id", teamId)
    .eq("status", "approved")
    .gte("perf_date", start)
    .lte("perf_date", end);
  if (error) throw new Error(`加载团队流水失败：${error.message}`);
  const map = new Map<string, number>();
  for (const r of data ?? []) {
    // deno-lint-ignore no-explicit-any
    const row = r as any;
    map.set(
      row.profile_id,
      (map.get(row.profile_id) ?? 0) + (row.revenue_cents ?? 0),
    );
  }
  return map;
}

/** 对单个团队结算刚结束的上一周期。返回生成/更新的记录数。 */
async function settleTeam(db: Db, team: TeamRow, asOf: string): Promise<number> {
  const period = getPreviousPeriodRange(
    team.settlement_type,
    team.settlement_start_day,
    asOf,
  );
  // 幂等：该周期已结算则跳过（RPC 内亦会在行锁下二次校验）。
  if (team.last_settled_period_end === period.end) return 0;

  const members = await loadMembers(db, team.id, period.start, period.end);
  const revenueMap = members.length
    ? await loadRevenue(db, team.id, period.start, period.end)
    : new Map<string, number>();

  // 库外计算（与 TS 领域口径一致），组装每个成员的结果，交由 RPC 在单事务内落库。
  // 无成员时传空数组：RPC 仍在团队行锁 + 幂等/防倒退校验下推进游标，不再绕过事务锁。
  const payloadMembers = members.map((member) => {
    const revenueCents = revenueMap.get(member.profileId) ?? 0;
    const tenureMonth = calcTenureMonth(member.hireDate, period.end);
    const p = computePayroll({
      scheme: member.scheme,
      monthlyRevenueInCents: revenueCents,
      tenureMonth,
    });
    return {
      profileId: member.profileId,
      positionId: member.positionId,
      schemeId: member.schemeId,
      revenueCents,
      tenureMonth,
      thresholdCents: p.thresholdInCents,
      isQualified: p.isQualified,
      isGracePeriod: p.isGracefulPeriod,
      guaranteedComponentCents: p.guaranteedComponentInCents,
      performanceComponentCents: p.performanceComponentInCents,
      grossCents: p.grossSalaryInCents,
      serviceFeeCents: p.serviceFeeInCents,
      netCents: p.netSalaryInCents,
      commissionRateBps: member.commissionRateBps,
    };
  });

  // 事务原子性 + 并发行锁：批量 upsert（业务唯一键）、新建记录写日志、推进游标，
  // 全部在 settle_team_period 单事务内完成；失败整体回滚，游标不推进，下次重试。
  const { data: count, error: rpcErr } = await db.rpc("settle_team_period", {
    p_team_id: team.id,
    p_period_start: period.start,
    p_period_end: period.end,
    p_members: payloadMembers,
  });
  if (rpcErr) {
    throw new Error(`团队 ${team.id} 结算落库失败：${rpcErr.message}`);
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
): Promise<{ ok: true; isCron: boolean } | { ok: false; status: number; message: string }> {
  const cronSecret = Deno.env.get("SETTLE_CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (cronSecret && providedCron && providedCron === cronSecret) {
    return { ok: true, isCron: true };
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
  return { ok: true, isCron: false };
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

  // 全量扫描属高权限操作，仅允许 cron secret 触发；管理员 JWT 只能针对指定 teamId 结算。
  if (!teamId && !auth.isCron) {
    return json({ code: "FORBIDDEN", message: "管理员触发必须指定 teamId" }, 403);
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
    // 手动指定 teamId 时不强制当日为周期第一天；cron 全量扫描时仅处理周期第一天的团队。
    if (!teamId && !isPeriodFirstDay(t.settlement_type, t.settlement_start_day, asOf)) {
      continue;
    }
    try {
      const n = await settleTeam(db, t, asOf);
      if (n > 0) settledTeams += 1;
      settledRecords += n;
    } catch (e) {
      // 单团队失败不阻断其余团队；该团队未推进周期，下次触发会重试。
      failedTeams.push({ teamId: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    code: failedTeams.length > 0 ? "PARTIAL" : "OK",
    message: failedTeams.length > 0 ? "结算部分完成，存在失败团队" : "结算完成",
    asOf,
    settledTeams,
    settledRecords,
    failedTeams,
  }, failedTeams.length > 0 ? 207 : 200);
});