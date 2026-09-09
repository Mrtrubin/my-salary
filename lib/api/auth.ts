/**
 * 认证业务域 API。
 * 统一封装 Supabase Auth 的登录 / 注册 / 登出 / 会话读取，页面与组件不直接引用 supabase 客户端。
 * 用户名账号统一映射到内部合成邮箱（{username}@users.noreply.mysalary.app），
 * 真实邮箱（选填）保存在 profiles.email 作为联系方式。
 */
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";

/** 用户名映射的内部合成邮箱域名（非真实邮箱，仅作 Auth 标识）。 */
const SYNTHETIC_EMAIL_DOMAIN = "users.noreply.mysalary.app";

export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

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

/** 用户名（或用户名/邮箱混合输入）归一化为 Auth 邮箱。 */
function usernameToAuthEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** 用户名 + 密码登录，成功返回登录用户信息。 */
export async function signInWithPassword({
  username,
  password,
}: SignInInput): Promise<AuthUser> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  });

  if (error) {
    // Supabase 对无效凭证统一返回 400 invalid_login_credentials，
    // 归一化为 UNAUTHENTICATED，避免向用户区分「账号不存在」与「密码错误」。
    throw new ApiError(ApiErrorCode.UNAUTHENTICATED, error.message, error);
  }

  const user = data.user;
  if (!user) {
    throw new ApiError(ApiErrorCode.UNKNOWN, "登录未返回用户信息", data);
  }

  return { id: user.id, email: user.email ?? null };
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
