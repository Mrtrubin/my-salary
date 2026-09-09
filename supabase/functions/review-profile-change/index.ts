import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/crypto.ts";

/**
 * 管理员审核成员资料修改申请（字段级）。
 * - 仅 system_role = 'admin' 可调用
 * - 支持单条 / 多条 / 一键（传入某成员全部 pending 的 ids）
 * - approve：将对应字段值写入 profiles（email 唯一性二次校验），申请置 approved
 *   password 类特殊：解密 secret_value 后调用 auth.admin.updateUserById 写入 Supabase Auth
 * - reject：reason 必填非空，申请置 rejected 并记录驳回文案
 * - 逐条独立处理：仅处理仍为 pending 的申请，返回处理汇总
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 6;

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

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ code: "UNAUTHENTICATED", message: "缺少登录凭证" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) return json({ code: "UNAUTHENTICATED", message: "登录状态无效" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("id, system_role")
    .eq("auth_user_id", caller.user.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.system_role !== "admin") {
    return json({ code: "FORBIDDEN", message: "仅管理员可审核资料修改" }, 403);
  }

  let payload: { ids?: string[]; action?: string; reason?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const ids = Array.isArray(payload.ids) ? [...new Set(payload.ids.filter(Boolean))] : [];
  if (ids.length === 0) return json({ code: "INVALID_INPUT", message: "缺少要审核的申请" }, 400);
  const action = payload.action;
  if (action !== "approve" && action !== "reject") {
    return json({ code: "INVALID_INPUT", message: "action 必须是 approve 或 reject" }, 400);
  }
  const reason = (payload.reason ?? "").trim();
  if (action === "reject" && reason === "") {
    return json({ code: "INVALID_INPUT", message: "驳回必须填写原因" }, 400);
  }

  const { data: requests, error: fetchError } = await admin
    .from("profile_change_requests")
    .select("id, profile_id, field, new_value, secret_value, status")
    .in("id", ids)
    .eq("status", "pending");
  if (fetchError) return json({ code: "UNKNOWN", message: "查询申请失败，请稍后再试" }, 500);
  if (!requests || requests.length === 0) {
    return json({ code: "INVALID_INPUT", message: "没有可处理的待审核申请" }, 400);
  }

  const nowIso = new Date().toISOString();
  let approved = 0;
  let rejected = 0;
  const failures: { id: string; message: string }[] = [];

  for (const request of requests) {
    if (action === "reject") {
      const { error } = await admin
        .from("profile_change_requests")
        .update({ status: "rejected", reject_reason: reason, reviewed_by: callerProfile.id, reviewed_at: nowIso, updated_at: nowIso })
        .eq("id", request.id)
        .eq("status", "pending");
      if (error) failures.push({ id: request.id, message: "驳回失败" });
      else rejected += 1;
      continue;
    }

    // approve：email 唯一性二次校验后落库到 profiles
    const field = request.field as string;
    const value = request.new_value as string | null;

    // password 类：解密临时密码后写入 Supabase Auth，不落库到 profiles
    if (field === "password") {
      const secret = Deno.env.get("CHANGE_REQUEST_SECRET");
      if (!secret) {
        failures.push({ id: request.id, message: "服务端未配置加密密钥" });
        continue;
      }
      const cipher = request.secret_value as string | null;
      if (!cipher) {
        failures.push({ id: request.id, message: "缺少加密密码数据" });
        continue;
      }
      let newPassword: string;
      try {
        newPassword = await decryptSecret(cipher, secret);
      } catch {
        failures.push({ id: request.id, message: "解密密码失败" });
        continue;
      }
      if (newPassword.length < PASSWORD_MIN_LENGTH) {
        failures.push({ id: request.id, message: "新密码长度不足" });
        continue;
      }
      const { data: target } = await admin
        .from("profiles")
        .select("auth_user_id")
        .eq("id", request.profile_id)
        .maybeSingle();
      if (!target?.auth_user_id) {
        failures.push({ id: request.id, message: "未找到登录账号" });
        continue;
      }
      const { error: pwdError } = await admin.auth.admin.updateUserById(target.auth_user_id, { password: newPassword });
      if (pwdError) {
        failures.push({ id: request.id, message: "写入新密码失败" });
        continue;
      }
      // 落库成功后清除密文，避免密文长期驻留
      const { error: statusError } = await admin
        .from("profile_change_requests")
        .update({ status: "approved", secret_value: null, reviewed_by: callerProfile.id, reviewed_at: nowIso, updated_at: nowIso })
        .eq("id", request.id)
        .eq("status", "pending");
      if (statusError) failures.push({ id: request.id, message: "更新申请状态失败" });
      else approved += 1;
      continue;
    }

    if (field === "email" && value) {
      if (!EMAIL_RE.test(value)) {
        failures.push({ id: request.id, message: "邮箱格式不正确" });
        continue;
      }
      const { data: dup } = await admin.from("profiles").select("id").ilike("email", value).neq("id", request.profile_id).maybeSingle();
      if (dup) {
        failures.push({ id: request.id, message: "该邮箱已被占用" });
        continue;
      }
    }
    if (field === "name" && (!value || value.trim() === "")) {
      failures.push({ id: request.id, message: "姓名不能为空" });
      continue;
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ [field]: value, updated_at: nowIso })
      .eq("id", request.profile_id);
    if (profileError) {
      failures.push({ id: request.id, message: "写入资料失败" });
      continue;
    }

    const { error: statusError } = await admin
      .from("profile_change_requests")
      .update({ status: "approved", reviewed_by: callerProfile.id, reviewed_at: nowIso, updated_at: nowIso })
      .eq("id", request.id)
      .eq("status", "pending");
    if (statusError) failures.push({ id: request.id, message: "更新申请状态失败" });
    else approved += 1;
  }

  return json({ code: "OK", message: "审核完成", approved, rejected, failures });
});