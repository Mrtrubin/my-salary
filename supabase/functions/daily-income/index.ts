import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * 主播流水代理（按日期）：浏览器不再直连外部流水服务，改由边缘函数代取。
 *
 * 为什么要有这一层：
 *   1. 上游是 http 明文且不带 CORS 头，页面部署到 https（GitHub Pages）后浏览器会以
 *      mixed content / CORS 直接拦掉直连；
 *   2. 上游地址属于内网/运维信息，不应打进客户端 bundle；
 *   3. 顺带把「谁能拉哪个团队的流水」收敛到服务端校验。
 *
 * 请求：POST { anchorId, date }（anchorId 即团队的 team_key；date 为 YYYY-MM-DD，缺省取当天）
 * 上游：GET {DAILY_INCOME_BASE}/api/daily-income?anchor_id={anchorId}&date={date}
 *      返回体 { success, data: { anchor_id, date, hasLive, liveDuration, rooms: [...] } }
 * 响应：{ code: "OK", message, data } —— data 为上游 data 字段**原样透传**，
 *      「按抖音号聚合」仍在前端做（见 app/(user)/user/performance/upload/dailyIncome.ts）。
 *
 * 鉴权：校验 JWT，且调用者必须是该团队的管理员/主持/成员（与 public.teams 的
 *      teams_select RLS 策略同一口径），否则 403 —— 避免边缘函数沦为任意团队流水的开放代理。
 *
 * 环境变量：DAILY_INCOME_BASE（可选，默认 http://47.121.31.8:3000）
 */
const DEFAULT_DAILY_INCOME_BASE = "http://47.121.31.8:3000";
/** 上游超时（毫秒）：外部接口偶发挂死时不要一直占着边缘函数连接。 */
const UPSTREAM_TIMEOUT_MS = 10_000;
/** 流水上游按北京时间的「日历日」取数。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** 北京时间当天（YYYY-MM-DD）。 */
function todayInShanghai(): string {
  return new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 严格校验 YYYY-MM-DD：格式正确且是真实存在的日历日（拒绝 2026-02-30）。 */
function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("no content", { headers: corsHeaders });
  if (req.method !== "POST") return json({ code: "UNKNOWN", message: "仅支持 POST" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ code: "UNAUTHENTICATED", message: "缺少登录凭证" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) {
    return json({ code: "UNAUTHENTICATED", message: "登录状态无效" }, 401);
  }

  let payload: { anchorId?: unknown; date?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const anchorId = typeof payload.anchorId === "string" ? payload.anchorId.trim() : "";
  if (!anchorId) return json({ code: "INVALID_INPUT", message: "缺少团队 ID" }, 400);

  // 目标日期：缺省取北京时间当天（兼容旧客户端），显式传入时必须是真实存在的日历日，且不能是未来。
  const rawDate = typeof payload.date === "string" ? payload.date.trim() : "";
  const date = rawDate || todayInShanghai();
  if (!isValidDate(date)) {
    return json({ code: "INVALID_INPUT", message: "日期格式不正确，应为 YYYY-MM-DD" }, 400);
  }
  if (date > todayInShanghai()) {
    return json({ code: "INVALID_INPUT", message: "不能查询未来日期的流水" }, 400);
  }

  const { data: callerProfile, error: profileError } = await admin
    .from("profiles")
    .select("id, system_role")
    .eq("auth_user_id", caller.user.id)
    .maybeSingle();
  if (profileError) return json({ code: "UNKNOWN", message: "读取调用者资料失败，请稍后再试" }, 500);
  if (!callerProfile) return json({ code: "FORBIDDEN", message: "当前账号没有成员资料" }, 403);

  // anchor_id 就是 teams.team_key：先定位团队，再按 teams_select 的口径校验可见性。
  const { data: team, error: teamError } = await admin
    .from("teams")
    .select("id, host_profile_id")
    .eq("team_key", anchorId)
    .maybeSingle();
  if (teamError) return json({ code: "UNKNOWN", message: "查询团队失败，请稍后再试" }, 500);
  if (!team) return json({ code: "TEAM_NOT_FOUND", message: "团队不存在，请核对团队 ID" }, 404);

  if (callerProfile.system_role !== "admin" && team.host_profile_id !== callerProfile.id) {
    // 与 RLS 一致：只要求存在 team_members 关联，不过滤 left_at（离职成员仍可见历史团队）。
    const { data: member, error: memberError } = await admin
      .from("team_members")
      .select("profile_id")
      .eq("team_id", team.id)
      .eq("profile_id", callerProfile.id)
      .maybeSingle();
    if (memberError) return json({ code: "UNKNOWN", message: "校验团队归属失败，请稍后再试" }, 500);
    if (!member) return json({ code: "FORBIDDEN", message: "你不在该团队中，无法拉取流水" }, 403);
  }

  const base = (Deno.env.get("DAILY_INCOME_BASE") ?? DEFAULT_DAILY_INCOME_BASE).replace(/\/+$/, "");
  const upstreamUrl = `${base}/api/daily-income?anchor_id=${encodeURIComponent(anchorId)}&date=${encodeURIComponent(date)}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("daily-income upstream unreachable", anchorId, date, err);
    return json({ code: "UPSTREAM_FAILED", message: "流水接口不可达，请稍后再试" }, 502);
  }

  if (!upstream.ok) {
    console.error("daily-income upstream status", anchorId, date, upstream.status);
    return json({ code: "UPSTREAM_FAILED", message: `流水接口请求失败（HTTP ${upstream.status}）` }, 502);
  }

  let body: { success?: boolean; message?: string; data?: unknown } | null = null;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }

  if (!body || !body.success || !body.data || typeof body.data !== "object") {
    console.error("daily-income upstream payload invalid", anchorId, date, body?.message);
    return json({ code: "UPSTREAM_FAILED", message: body?.message || "流水接口返回失败" }, 502);
  }

  return json({ code: "OK", message: "获取流水成功", data: body.data });
});
