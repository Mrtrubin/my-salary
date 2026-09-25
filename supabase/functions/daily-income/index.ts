import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * 当日主播流水代理：浏览器不再直连外部流水服务，改由边缘函数代取。
 *
 * 为什么要有这一层：
 *   1. 上游是 http 明文且不带 CORS 头，页面部署到 https（GitHub Pages）后浏览器会以
 *      mixed content / CORS 直接拦掉直连；
 *   2. 上游地址属于内网/运维信息，不应打进客户端 bundle；
 *   3. 顺带把「谁能拉哪个团队的流水」收敛到服务端校验。
 *
 * 请求：POST { anchorId }（anchorId 即团队的 team_key）
 * 上游：GET {DAILY_INCOME_BASE}/api/daily-income?anchor_id={anchorId}
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let payload: { anchorId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const anchorId = (payload.anchorId ?? "").trim();
  if (!anchorId) return json({ code: "INVALID_INPUT", message: "缺少团队 ID" }, 400);

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
  const upstreamUrl = `${base}/api/daily-income?anchor_id=${encodeURIComponent(anchorId)}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("daily-income upstream unreachable", anchorId, err);
    return json({ code: "UPSTREAM_FAILED", message: "流水接口不可达，请稍后再试" }, 502);
  }

  if (!upstream.ok) {
    console.error("daily-income upstream status", anchorId, upstream.status);
    return json({ code: "UPSTREAM_FAILED", message: `流水接口请求失败（HTTP ${upstream.status}）` }, 502);
  }

  let body: { success?: boolean; message?: string; data?: unknown } | null = null;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }

  if (!body || !body.success || !body.data) {
    console.error("daily-income upstream payload invalid", anchorId, body?.message);
    return json({ code: "UPSTREAM_FAILED", message: body?.message || "流水接口返回失败" }, 502);
  }

  return json({ code: "OK", message: "获取流水成功", data: body.data });
});
