/**
 * 认证业务域 API。
 * 统一封装 Supabase Auth 的登录 / 注册 / 登出 / 会话读取，页面与组件不直接引用 supabase 客户端。
 * 登录经 auth-login Edge Function：用户名 → profiles → auth 邮箱 → 验证密码 → 返回 session token。
 * 注册经 auth-register Edge Function 创建 Auth 用户与成员资料。
 */
import { getBrowserSupabase } from "@/lib/supabase/client";
import { invokeEdgeFunction } from "@/lib/api/client";
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

/** 登录接口返回体（access_token 等凭证在顶层，不在 data 内）。 */
interface LoginResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id: string; email: string | null };
}

/** 用户名 + 密码登录，成功返回登录用户信息。 */
export async function signInWithPassword({
  username,
  password,
}: SignInInput): Promise<AuthUser> {
  // 登录前没有会话，显式只用 anon key；网络失败会归一化为 NETWORK 并附带原因。
  const body = await invokeEdgeFunction<LoginResponse>("auth-login", {
    username: username.trim(),
    password,
  }, {
    withSession: false,
    fallbackMessage: "登录失败",
    codeMessages: {
      UNAUTHENTICATED: "用户名或密码错误",
      FORBIDDEN: "账号已停用，请联系管理员",
      INVALID_INPUT: "输入不合法",
    },
  });

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
  await invokeEdgeFunction("auth-register", {
    username: input.username.trim().toLowerCase(),
    password: input.password,
    email: input.email?.trim() ?? "",
    name: input.name?.trim() ?? "",
  }, {
    fallbackMessage: "注册失败",
    codeMessages: {
      USERNAME_TAKEN: "该用户名已被注册",
      INVALID_INPUT: "输入不合法",
    },
  });
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
