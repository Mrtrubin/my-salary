import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * 自助注册：用户名 + 密码 + 选填邮箱。
 * - service role 绕过 RLS，写入 auth.users + public.profiles
 * - email_confirmed_at 直接置位（内部用户名账号，无需真实邮箱验证）
 * - 首个注册账号成为 admin（bootstrap），其余为 user
 */
const SYNTHETIC_DOMAIN = "users.noreply.mysalary.app";
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let payload: { username?: string; password?: string; email?: string; name?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const username = (payload.username ?? "").trim().toLowerCase();
  const password = payload.password ?? "";
  const email = (payload.email ?? "").trim().toLowerCase();
  const name = (payload.name ?? "").trim();

  if (!USERNAME_RE.test(username)) {
    return json({ code: "INVALID_INPUT", message: "用户名需 3-32 位小写字母/数字/下划线/连字符" }, 400);
  }
  if (password.length < 6 || password.length > 64) {
    return json({ code: "INVALID_INPUT", message: "密码长度需 6-64 位" }, 400);
  }
  if (email !== "" && !EMAIL_RE.test(email)) {
    return json({ code: "INVALID_INPUT", message: "邮箱格式不正确" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 用户名唯一性：profiles.username 唯一索引兜底，这里提前给出友好错误
  const { data: existing } = await admin
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();
  if (existing) return json({ code: "USERNAME_TAKEN", message: "该用户名已被注册" }, 409);

  // 首个注册账号成为 admin
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
  const systemRole = (count ?? 0) === 0 ? "admin" : "user";

  // 用户名账号统一映射到内部合成邮箱（域名已验证可登录），真实邮箱存 profiles.email 作联系方式
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `${username}@${SYNTHETIC_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { username, name: name || username },
  });
  if (createError || !created?.user) {
    return json({ code: "UNKNOWN", message: "创建账号失败，请稍后再试" }, 500);
  }

  const { error: profileError } = await admin.from("profiles").insert({
    auth_user_id: created.user.id,
    username,
    name: name || username,
    email: email === "" ? null : email,
    phone: "",
    hire_date: new Date().toISOString().slice(0, 10),
    system_role: systemRole,
  });
  if (profileError) {
    // 回滚 auth 用户，避免出现无 profile 的孤儿账号
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ code: "UNKNOWN", message: "创建成员资料失败，请稍后再试" }, 500);
  }

  return json({ code: "OK", message: "注册成功" });
});
