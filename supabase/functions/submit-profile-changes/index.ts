import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * 成员提交自己资料的修改申请（字段级审核）。
 * - 任意登录成员可调用，仅能为「自己」提交
 * - 允许一次批量提交多个字段，共享一个 batch_id
 * - 字段级校验；过滤掉与当前值相同的无效变更
 * - 覆盖策略：同一 field 已有 pending 时，先置为 superseded，再插入新的 pending
 *   （以 service role 绕过 RLS，规避唯一索引 pcr_one_pending_per_field 冲突）
 * - 可申请字段：name / phone / email / id_card；其余字段仅管理员可改
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_FIELDS = ["name", "phone", "email", "id_card"] as const;
type Field = (typeof ALLOWED_FIELDS)[number];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** 归一化字段值：trim；email 转小写；空串对email/id_card 视为清空(null)。 */
function normalize(field: Field, raw: string): string | null {
  const value = (raw ?? "").trim();
  if (field === "email") return value === "" ? null : value.toLowerCase();
  if (field === "id_card") return value === "" ? null : value;
  return value;
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

  const { data: profile } = await admin
    .from("profiles")
    .select("id, name, phone, email, id_card")
    .eq("auth_user_id", caller.user.id)
    .maybeSingle();
  if (!profile) return json({ code: "FORBIDDEN", message: "未找到成员资料" }, 403);

  let payload: { changes?: { field?: string; newValue?: string }[] };
  try {
    payload = await req.json();
  } catch {
    return json({ code: "INVALID_INPUT", message: "请求体必须是 JSON" }, 400);
  }
  if (!Array.isArray(payload.changes) || payload.changes.length === 0) {
    return json({ code: "INVALID_INPUT", message: "缺少要提交的修改" }, 400);
  }

  // 逐字段校验 + 去重 + 过滤未变更；后出现的同字段覆盖前者
  const current: Record<Field, string | null> = {
    name: profile.name ?? null,
    phone: profile.phone ?? null,
    email: profile.email ?? null,
    id_card: profile.id_card ?? null,
  };
  const pending = new Map<Field, string | null>();

  for (const change of payload.changes) {
    const field = change.field as Field;
    if (!ALLOWED_FIELDS.includes(field)) {
      return json({ code: "INVALID_INPUT", message: `不支持修改字段：${change.field}` }, 400);
    }
    const value = normalize(field, change.newValue ?? "");
    if (field === "name" && (value === null || value === "")) {
      return json({ code: "INVALID_INPUT", message: "姓名不能为空" }, 400);
    }
    if (field === "email" && value !== null && !EMAIL_RE.test(value)) {
      return json({ code: "INVALID_INPUT", message: "邮箱格式不正确" }, 400);
    }
    pending.set(field, value);
  }

  // 邮箱唯一性预校验（排除自己）
  const emailValue = pending.get("email");
  if (pending.has("email") && emailValue) {
    const { data: dup } = await admin.from("profiles").select("id").ilike("email", emailValue).neq("id", profile.id).maybeSingle();
    if (dup) return json({ code: "EMAIL_TAKEN", message: "该邮箱已被占用" }, 409);
  }

  // 过滤掉与当前值相同的字段
  const effective: { field: Field; oldValue: string | null; newValue: string | null }[] = [];
  for (const [field, value] of pending) {
    if ((current[field] ?? null) === (value ?? null)) continue;
    effective.push({ field, oldValue: current[field] ?? null, newValue: value });
  }
  if (effective.length === 0) return json({ code: "INVALID_INPUT", message: "没有需要修改的内容" }, 400);

  const batchId = crypto.randomUUID();

  // 覆盖旧 pending：将本次涉及字段的现有 pending 置为 superseded
  const fields = effective.map((item) => item.field);
  const { error: supersedeError } = await admin
    .from("profile_change_requests")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .eq("status", "pending")
    .in("field", fields);
  if (supersedeError) return json({ code: "UNKNOWN", message: "作废旧申请失败，请稍后再试" }, 500);

  // 插入新 pending
  const { error: insertError } = await admin.from("profile_change_requests").insert(
    effective.map((item) => ({
      profile_id: profile.id,
      field: item.field,
      old_value: item.oldValue,
      new_value: item.newValue,
      batch_id: batchId,
      status: "pending",
    }))
  );
  if (insertError) return json({ code: "UNKNOWN", message: "提交修改申请失败，请稍后再试" }, 500);

  return json({ code: "OK", message: "提交成功，等待管理员审核", batchId, count: effective.length });
});