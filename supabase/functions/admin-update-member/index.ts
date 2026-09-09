import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * 管理员编辑成员：更新成员资料（public.profiles）+ 职位关联（user_positions）+ 可选重置登录密码。
 * - 仅允许 system_role = 'admin' 的登录用户调用（依据请求 JWT 校验）
 * - service role 绕过 RLS 写入
 * - 防呆：字段级校验、用户名/邮箱唯一性（排除自身）、密码可选、禁止停用/降权自己造成自锁
 * - 未提供的字段一律不更新（undefined 表示"保持不变"）
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ code: "UNAUTHENTICATED", message: "缺少登录凭证" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 校验调用者身份并确认其为管理员
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) {
    return json({ code: "UNAUTHENTICATED", message: "登录状态无效" }, 401);
  }
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("id, system_role")
    .eq("auth_user_id", caller.user.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.system_role !== "admin") {
    return json({ code: "FORBIDDEN", message: "仅管理员可编辑成员" }, 403);
  }

  let payload: {
    id?: string;
    username?: string;
    password?: string;
    name?: string;
    phone?: string;
    email?: string;
    hireDate?: string;
    idCard?: string;
    status?: string;
    positionIds?: number[];
  };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const id = (payload.id ?? "").trim();
  if (!id) return json({ code: "INVALID_INPUT", message: "缺少成员 ID" }, 400);

  // 目标成员必须存在
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id, auth_user_id, system_role")
    .eq("id", id)
    .maybeSingle();
  if (targetError) return json({ code: "UNKNOWN", message: "查询成员失败，请稍后再试" }, 500);
  if (!target) return json({ code: "INVALID_INPUT", message: "成员不存在" }, 404);

  const isSelf = target.id === callerProfile.id;

  // 逐字段构造更新对象：undefined 表示不改动
  const updates: Record<string, unknown> = {};

  if (payload.username !== undefined) {
    const username = payload.username.trim();
    if (username.length < 1 || username.length > 32) {
      return json({ code: "INVALID_INPUT", message: "用户名长度需 1-32 个字符" }, 400);
    }
    const { data: dup } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", id)
      .maybeSingle();
    if (dup) return json({ code: "USERNAME_TAKEN", message: "该用户名已被占用" }, 409);
    updates.username = username;
  }

  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (name.length < 1) return json({ code: "INVALID_INPUT", message: "姓名不能为空" }, 400);
    updates.name = name;
  }

  if (payload.phone !== undefined) updates.phone = payload.phone.trim();

  if (payload.email !== undefined) {
    const email = payload.email.trim().toLowerCase();
    if (email !== "" && !EMAIL_RE.test(email)) {
      return json({ code: "INVALID_INPUT", message: "邮箱格式不正确" }, 400);
    }
    if (email !== "") {
      const { data: dup } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .neq("id", id)
        .maybeSingle();
      if (dup) return json({ code: "EMAIL_TAKEN", message: "该邮箱已被占用" }, 409);
    }
    updates.email = email === "" ? null : email;
  }

  if (payload.hireDate !== undefined) {
    const hireDate = payload.hireDate.trim();
    if (!DATE_RE.test(hireDate)) {
      return json({ code: "INVALID_INPUT", message: "入职日期格式应为 YYYY-MM-DD" }, 400);
    }
    updates.hire_date = hireDate;
  }

  if (payload.idCard !== undefined) {
    const idCard = payload.idCard.trim();
    updates.id_card = idCard === "" ? null : idCard;
  }

  if (payload.status !== undefined) {
    if (payload.status !== "active" && payload.status !== "disabled") {
      return json({ code: "INVALID_INPUT", message: "状态非法" }, 400);
    }
    // 防呆：禁止管理员停用自己，避免自锁
    if (isSelf && payload.status === "disabled") {
      return json({ code: "INVALID_INPUT", message: "不能停用自己的账号" }, 400);
    }
    updates.status = payload.status;
  }

  // 密码可选重置（走 auth admin，需 auth_user_id）
  const password = payload.password;
  if (password !== undefined && password !== "") {
    if (password.length < 6 || password.length > 64) {
      return json({ code: "INVALID_INPUT", message: "密码长度需 6-64 位" }, 400);
    }
    if (!target.auth_user_id) {
      return json({ code: "INVALID_INPUT", message: "该成员无登录账号，无法重置密码" }, 400);
    }
    const { error: pwdError } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
    if (pwdError) return json({ code: "UNKNOWN", message: "重置密码失败，请稍后再试" }, 500);
  }

  // 写入资料更新（有变更才写）
  if (Object.keys(updates).length) {
    updates.updated_at = new Date().toISOString();
    const { error: updateError } = await admin.from("profiles").update(updates).eq("id", id);
    if (updateError) {
      const taken = updateError.code === "23505";
      return json(
        taken
          ? { code: "USERNAME_TAKEN", message: "用户名或邮箱已被占用" }
          : { code: "UNKNOWN", message: "更新成员资料失败，请稍后再试" },
        taken ? 409 : 500
      );
    }
  }

  // 职位差异更新（提供 positionIds 才处理，全量覆盖）
  if (payload.positionIds !== undefined) {
    const desired = Array.isArray(payload.positionIds) ? [...new Set(payload.positionIds)] : [];
    const { data: current, error: curErr } = await admin
      .from("user_positions")
      .select("position_id")
      .eq("profile_id", id);
    if (curErr) return json({ code: "UNKNOWN", message: "读取职位失败，请稍后再试" }, 500);
    const currentIds = new Set((current ?? []).map((r) => r.position_id as number));
    const desiredSet = new Set(desired);
    const toAdd = desired.filter((pid) => !currentIds.has(pid));
    const toRemove = [...currentIds].filter((pid) => !desiredSet.has(pid));

    if (toRemove.length) {
      const { error: delErr } = await admin
        .from("user_positions")
        .delete()
        .eq("profile_id", id)
        .in("position_id", toRemove);
      if (delErr) return json({ code: "UNKNOWN", message: "移除职位失败，请稍后再试" }, 500);
    }
    if (toAdd.length) {
      const { error: addErr } = await admin
        .from("user_positions")
        .insert(toAdd.map((positionId) => ({ profile_id: id, position_id: positionId })));
      if (addErr) return json({ code: "UNKNOWN", message: "新增职位失败，请稍后再试" }, 500);
    }
  }

  return json({ code: "OK", message: "更新成员成功", id });
});