import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/crypto.ts";

/**
 * 成员提交「修改密码」申请（走管理员审核，与资料修改一致）。
 * - 先用「合成邮箱 + 当前密码」校验身份，凭证错误即拒绝
 * - 新密码不明文落库：用 CHANGE_REQUEST_SECRET 经 AES-GCM 加密后写入 secret_value
 * - new_value/old_value 仅存脱敏占位，管理端不回显真实密码
 * - 覆盖策略：同一 profile 已有 password pending 时先置 superseded，再插入新 pending
 * - 审核通过由 review-profile-change 解密 secret_value 后写入 Supabase Auth
 */
const PASSWORD_MIN_LENGTH = 6;
const MASK = "••••••";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("no content", { headers: corsHeaders });
  if (req.method !== "POST") return json({ code: "UNKNOWN", message: "仅支持 POST" }, 405);

  const secret = Deno.env.get("CHANGE_REQUEST_SECRET");
  if (!secret) return json({ code: "UNKNOWN", message: "服务端未配置加密密钥" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ code: "UNAUTHENTICATED", message: "缺少登录凭证" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) return json({ code: "UNAUTHENTICATED", message: "登录状态无效" }, 401);

  const email = caller.user.email;
  if (!email) return json({ code: "UNAUTHENTICATED", message: "账号缺少登录标识" }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", caller.user.id)
    .maybeSingle();
  if (!profile) return json({ code: "FORBIDDEN", message: "未找到成员资料" }, 403);

  let payload: { currentPassword?: string; newPassword?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const currentPassword = (payload.currentPassword ?? "").trim();
  const newPassword = (payload.newPassword ?? "").trim();
  if (!currentPassword || !newPassword) return json({ code: "INVALID_INPUT", message: "请填写当前密码与新密码" }, 400);
  if (newPassword.length < PASSWORD_MIN_LENGTH) return json({ code: "INVALID_INPUT", message: `新密码至少 ${PASSWORD_MIN_LENGTH} 位` }, 400);
  if (newPassword === currentPassword) return json({ code: "INVALID_INPUT", message: "新密码不能与当前密码相同" }, 400);

  // 用当前密码校验身份（独立 anon client，不影响本次调用会话）
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: reauthError } = await anon.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) return json({ code: "INVALID_INPUT", message: "当前密码不正确" }, 400);

  const encrypted = await encryptSecret(newPassword, secret);
  const batchId = crypto.randomUUID();

  // 覆盖旧 pending 的改密申请
  const { error: supersedeError } = await admin
    .from("profile_change_requests")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .eq("status", "pending")
    .eq("field", "password");
  if (supersedeError) {
    console.error("supersede failed", supersedeError);
    return json({ code: "UNKNOWN", message: `作废旧申请失败：${supersedeError.message}` }, 500);
  }

  const { error: insertError } = await admin.from("profile_change_requests").insert({
    profile_id: profile.id,
    field: "password",
    old_value: MASK,
    new_value: MASK,
    secret_value: encrypted,
    batch_id: batchId,
    status: "pending",
  });
  if (insertError) {
    console.error("insert failed", insertError);
    return json({ code: "UNKNOWN", message: `提交修改申请失败：${insertError.message}` }, 500);
  }

  return json({ code: "OK", message: "提交成功，等待管理员审核", batchId, count: 1 });
});