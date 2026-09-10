import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * 用户名 + 密码登录。
 * - 接收 username + password，通过 profiles.username 查找对应 auth_user_id
 * - 用 service role 获取 auth user 的合成邮箱
 * - 用 anon client 以邮箱 + 密码验证凭证，成功后返回 access_token / refresh_token
 * - 前端拿到 token 后调用 supabase.auth.setSession() 建立本地会话
 *
 * 背景：管理员创建成员时用户名允许 UTF-8（含中文），合成邮箱为随机串（不基于用户名），
 * 因此前端无法直接通过用户名拼接邮箱来调用 supabase.auth.signInWithPassword。
 */
const USERNAME_RE = /^[^\s]{1,32}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("no content", { headers: corsHeaders });
  if (req.method !== "POST") return json({ code: "UNKNOWN", message: "仅支持 POST" }, 405);

  let payload: { username?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const username = (payload.username ?? "").trim();
  const password = payload.password ?? "";

  if (!USERNAME_RE.test(username)) {
    return json({ code: "INVALID_INPUT", message: "用户名为 1-32 位非空白字符" }, 400);
  }
  if (!password) {
    return json({ code: "INVALID_INPUT", message: "请输入密码" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 通过用户名查找成员资料，获取 auth_user_id
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("auth_user_id, status")
    .eq("username", username)
    .maybeSingle();

  if (profileError) {
    return json({ code: "UNKNOWN", message: "查询用户失败，请稍后再试" }, 500);
  }
  if (!profile || !profile.auth_user_id) {
    return json({ code: "UNAUTHENTICATED", message: "用户名或密码错误" }, 401);
  }
  if (profile.status === "disabled") {
    return json({ code: "FORBIDDEN", message: "账号已停用，请联系管理员" }, 403);
  }

  // 用 service role 获取 auth user 的合成邮箱
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(
    profile.auth_user_id,
  );
  if (authError || !authUser?.user?.email) {
    return json({ code: "UNAUTHENTICATED", message: "用户名或密码错误" }, 401);
  }

  // 用 anon client 以邮箱 + 密码验证凭证
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  });

  if (signInError || !signInData.session) {
    return json({ code: "UNAUTHENTICATED", message: "用户名或密码错误" }, 401);
  }

  // 返回 session token，前端用 setSession 建立本地会话
  return json({
    code: "OK",
    message: "登录成功",
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
    expires_at: signInData.session.expires_at,
    user: { id: signInData.user.id, email: signInData.user.email ?? null },
  });
});