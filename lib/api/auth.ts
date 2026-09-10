/**
 * 认证业务域 API。
 * 统一封装 Supabase Auth 的登录 / 注册 / 登出 / 会话读取，页面与组件不直接引用 supabase 客户端。
 * 登录经 auth-login Edge Function：用户名 → profiles → auth 邮箱 → 验证密码 → 返回 session token。
 * 注册经 auth-register Edge Function 创建 Auth 用户与成员资料。
 */
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";

/**
 * 注册用用户名规则：3-32 位小写字母/数字/下划线/连字符。
 * 注册时用户名直接拼接为合成邮箱本地部分，需符合邮箱字符集限制。
 */
export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

/**
 * 登录用用户名规则：1-32 位任意非空白字符（含中文）。
 * 管理员创建成员时允许 UTF-8 用户名（见迁移 relax_username_utf8.sql），
 * 登录校验需与后端 admin-create-member / admin-update-member 的 1-32 字符约束一致。
 */
export const LOGIN_USERNAME_PATTERN = /^[^\s]{1,32}$/;

export interface SignInInput {
  username: string;
  password: string;
}

export interface SignUpInput {
  username: string;
  password: string;
  /** 选填联系邮箱，仅保存在成员资料中。 */
  email?: string;
  /** 选填显示姓名，缺省使用用户名。 */
  name?: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/** 用户名 + 密码登录，成功返回登录用户信息。 */
export async function signInWithPassword({
  username,
  password,
}: SignInInput): Promise<AuthUser> {
  const { url, anonKey } = getPublicSupabaseEnv();

  const response = await fetch(`${url}/functions/v1/auth-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  });

  let body: {
    code?: string;
    message?: string;
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    user?: { id: string; email: string | null };
  };
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.UNKNOWN, "登录服务响应异常", response.status);
  }

  if (!response.ok) {
    if (body.code === "UNAUTHENTICATED") {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, "用户名或密码错误", body);
    }
    if (body.code === "FORBIDDEN") {
      throw new ApiError(ApiErrorCode.FORBIDDEN, body.message ?? "账号已停用", body);
    }
    if (body.code === "INVALID_INPUT") {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, body.message ?? "输入不合法", body);
    }
    throw new ApiError(ApiErrorCode.UNKNOWN, body.message ?? "登录失败，请稍后再试", body);
  }

  // 用返回的 token 建立本地会话
  if (!body.access_token || !body.refresh_token) {
    throw new ApiError(ApiErrorCode.UNKNOWN, "登录未返回有效凭证", body);
  }

  const supabase = getBrowserSupabase();
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (sessionError) {
    throw new ApiError(ApiErrorCode.UNKNOWN, "建立登录会话失败", sessionError);
  }

  return body.user ?? { id: "", email: null };
}

/**
 * 自助注册（用户名 + 密码 + 选填邮箱）。
 * 经 auth-register Edge Function（service role）创建 Auth 用户与成员资料；
 * 首个注册账号自动成为管理员，其余为普通用户。
 */
export async function signUpWithUsername(input: SignUpInput): Promise<void> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = getBrowserSupabase();
  const { data: sessionData } = await supabase.auth.getSession();

  const response = await fetch(`${url}/functions/v1/auth-register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${sessionData.session?.access_token ?? anonKey}`,
    },
    body: JSON.stringify({
      username: input.username.trim().toLowerCase(),
      password: input.password,
      email: input.email?.trim() ?? "",
      name: input.name?.trim() ?? "",
    }),
  });

  let body: { code?: string; message?: string } = {};
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.UNKNOWN, "注册服务响应异常", response.status);
  }

  if (!response.ok) {
    if (body.code === "USERNAME_TAKEN") {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, "该用户名已被注册");
    }
    if (body.code === "INVALID_INPUT") {
      throw new ApiError(ApiErrorCode.INVALID_INPUT, body.message ?? "输入不合法");
    }
    throw new ApiError(ApiErrorCode.UNKNOWN, body.message ?? "注册失败，请稍后再试");
  }
}

/** 密码最小长度（与注册保持一致）。 */
export const PASSWORD_MIN_LENGTH = 6;

/** 登出当前会话。 */
export async function signOut(): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new ApiError(ApiErrorCode.UNKNOWN, error.message, error);
  }
}

/** 读取当前登录用户（未登录返回 null）。 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
