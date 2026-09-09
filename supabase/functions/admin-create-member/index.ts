import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * 管理员新增成员：一次性创建登录账号（auth.users）+ 成员资料（public.profiles）+ 职位关联。
 * - 仅允许 system_role = 'admin' 的登录用户调用（依据请求 JWT 校验）
 * - service role 绕过 RLS 写入
 * - 用户名允许 UTF-8（含中文），仅作展示与唯一标识
 * - 登录邮箱由固定前缀 + 随机串合成（用户名不参与邮箱），保证 Auth 邮箱合法
 * - 邮箱（联系用）选填；入职日期必填；姓名缺省使用用户名
 */
const SYNTHETIC_DOMAIN = "users.noreply.mysalary.app";
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

/** 生成合成登录邮箱：emp-{随机36进制串}@域名，与用户名无关。 */
function syntheticEmail(): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `emp-${rand}@${SYNTHETIC_DOMAIN}`;
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
    .select("system_role")
    .eq("auth_user_id", caller.user.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.system_role !== "admin") {
    return json({ code: "FORBIDDEN", message: "仅管理员可新增成员" }, 403);
  }

  let payload: {
    username?: string;
    password?: string;
    name?: string;
    phone?: string;
    email?: string;
    hireDate?: string;
    positionIds?: number[];
    idCard?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }

  const username = (payload.username ?? "").trim();
  const password = payload.password ?? "";
  const name = (payload.name ?? "").trim();
  const phone = (payload.phone ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();
  const hireDate = (payload.hireDate ?? "").trim();
  const positionIds = Array.isArray(payload.positionIds) ? payload.positionIds : [];
  const idCard = (payload.idCard ?? "").trim();

  if (username.length < 1 || username.length > 32) {
    return json({ code: "INVALID_INPUT", message: "用户名必填，长度 1-32 个字符" }, 400);
  }
  if (password.length < 6 || password.length > 64) {
    return json({ code: "INVALID_INPUT", message: "密码长度需 6-64 位" }, 400);
  }
  if (!DATE_RE.test(hireDate)) {
    return json({ code: "INVALID_INPUT", message: "入职日期必填，格式 YYYY-MM-DD" }, 400);
  }
  if (email !== "" && !EMAIL_RE.test(email)) {
    return json({ code: "INVALID_INPUT", message: "邮箱格式不正确" }, 400);
  }

  // 用户名唯一性预检（唯一索引兜底）
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existing) return json({ code: "USERNAME_TAKEN", message: "该用户名已被占用" }, 409);

  // 创建登录账号（合成邮箱，直接确认）
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail(),
    password,
    email_confirm: true,
    user_metadata: { username, name: name || username },
  });
  if (createError || !created?.user) {
    return json({ code: "UNKNOWN", message: "创建登录账号失败，请稍后再试" }, 500);
  }

  // 写入成员资料
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({
      auth_user_id: created.user.id,
      username,
      name: name || username,
      phone,
      email: email === "" ? null : email,
      hire_date: hireDate,
      id_card: idCard === "" ? null : idCard,
      system_role: "user",
    })
    .select("id")
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id);
    const taken = profileError?.code === "23505";
    return json(
      taken
        ? { code: "USERNAME_TAKEN", message: "该用户名已被占用" }
        : { code: "UNKNOWN", message: "创建成员资料失败，请稍后再试" },
      taken ? 409 : 500
    );
  }

  // 关联职位（选填）
  if (positionIds.length) {
    const { error: posError } = await admin
      .from("user_positions")
      .insert(positionIds.map((positionId) => ({ profile_id: profile.id, position_id: positionId })));
    if (posError) {
      // 职位关联失败不阻断主流程，但回滚以保持一致性
      await admin.from("profiles").delete().eq("id", profile.id);
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ code: "UNKNOWN", message: "关联职位失败，请稍后再试" }, 500);
    }
  }

  return json({ code: "OK", message: "新增成员成功", id: profile.id });
});