import type { PostgrestError } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { ApiError, ApiErrorCode } from "../contracts/errors";

/** Edge Function 统一响应契约：业务码 + 可读消息（+ 业务数据）。 */
export interface EdgeFunctionBody<TData = unknown> {
  code?: string;
  message?: string;
  data?: TData;
}

/** 业务码 → 应用错误码（未命中时再按 HTTP 状态推断）。 */
const EDGE_CODE_TO_API: Record<string, ApiErrorCode> = {
  UNAUTHENTICATED: ApiErrorCode.UNAUTHENTICATED,
  FORBIDDEN: ApiErrorCode.FORBIDDEN,
  INVALID_INPUT: ApiErrorCode.INVALID_INPUT,
  USERNAME_TAKEN: ApiErrorCode.INVALID_INPUT,
  EMAIL_TAKEN: ApiErrorCode.INVALID_INPUT,
  TEAM_NOT_FOUND: ApiErrorCode.NOT_FOUND,
  NOT_FOUND: ApiErrorCode.NOT_FOUND,
  CONFLICT: ApiErrorCode.CONFLICT,
};

const NETWORK_MESSAGE_PATTERN =
  /failed to fetch|load failed|networkerror|network error|econnreset|econnrefused|enotfound|err_connection|connection reset|socket hang up|timeout|aborted|aborterror/i;

function isAbortError(error: unknown): boolean {
  const candidate = error as { name?: string; code?: string } | null;
  return candidate?.name === "AbortError" || candidate?.name === "TimeoutError" || candidate?.code === "ABORT_ERR";
}

/**
 * 判断错误是否来自网络层（fetch 抛错 / ERR_CONNECTION_RESET / 超时 / PostgREST 网络失败）。
 * PostgREST 用空 code 表示客户端网络异常（`TypeError: Failed to fetch`），
 * 而 PostgreSQL 业务错误一定带 code（如 23505），据此避免误判。
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === ApiErrorCode.NETWORK;
  const candidate = error as { name?: string; code?: string; message?: string } | null;
  if (!candidate || typeof candidate !== "object") return false;
  if (isAbortError(candidate)) return true;
  const code = candidate.code ?? "";
  const message = candidate.message ?? "";
  // 带业务码的错误交给对应分支处理；仅放行 Abort 这类客户端 code。
  if (code && !/^ERR_/.test(code)) return false;
  return NETWORK_MESSAGE_PATTERN.test(message) || /^(typeerror|fetcherror):/i.test(message);
}

/** 网络层异常归一化：没有 HTTP 状态可参考，统一为 NETWORK 并给出可展示文案。 */
export function toNetworkError(error: unknown, fallbackMessage = "请求失败"): ApiError {
  if (error instanceof ApiError) return error;
  if (isAbortError(error)) {
    return new ApiError(ApiErrorCode.NETWORK, `${fallbackMessage}：请求已取消或超时，请重试`, error);
  }
  return new ApiError(ApiErrorCode.NETWORK, `${fallbackMessage}：网络连接异常，请检查网络后重试`, error);
}

/** HTTP 状态 → 应用错误码（后端未给业务码时兜底）。 */
function httpStatusToCode(status: number): ApiErrorCode {
  if (status === 401) return ApiErrorCode.UNAUTHENTICATED;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 409) return ApiErrorCode.CONFLICT;
  if (status === 400 || status === 422) return ApiErrorCode.INVALID_INPUT;
  return ApiErrorCode.UNKNOWN;
}

/** HTTP 状态 → 可读兜底文案（后端未返回 message、或响应不是 JSON 时使用）。 */
function httpStatusMessage(status: number): string {
  if (status === 400) return "请求参数有误，请检查后重试";
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 403) return "没有操作权限";
  if (status === 404) return "请求的资源不存在";
  if (status === 409) return "数据冲突，请刷新后重试";
  if (status === 429) return "操作过于频繁，请稍后重试";
  if (status >= 500) return "服务暂时不可用，请稍后重试";
  return "请求失败，请稍后重试";
}

export interface PostJsonOptions {
  /** 场景兜底前缀，如「登录失败」；拼在原因之前。 */
  fallbackMessage?: string;
  /** 按业务码覆盖兜底文案（仅后端未返回 message 时使用）。 */
  codeMessages?: Record<string, string>;
  /** 按业务码覆盖应用错误码。 */
  codeMap?: Record<string, ApiErrorCode>;
  signal?: AbortSignal;
}

/**
 * Edge Function 统一请求拦截器。集中收口三类此前各写各的处理：
 * 1. 网络层失败（断网 / DNS / `net::ERR_CONNECTION_RESET` / 超时）→ 归一化为 NETWORK，附带可读文案，
 *    而不是和业务错误一起被笼统当成「请求失败」；
 * 2. 响应不是合法 JSON（如网关 502 返回 HTML）→ 按 HTTP 状态给出兜底，绝不吞成成功；
 * 3. 后端未返回 message → 依次用「业务码文案 → HTTP 状态文案 → 场景兜底」补齐，
 *    保证抛出的 ApiError 一定有可展示的 message。
 */
export async function postJson<T = EdgeFunctionBody>(
  url: string,
  init: RequestInit,
  options: PostJsonOptions = {},
): Promise<T> {
  const { fallbackMessage = "请求失败", codeMessages = {}, codeMap = {}, signal } = options;

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: signal ?? init.signal });
  } catch (error) {
    // fetch 只在网络层失败时抛错，此时没有 HTTP 状态可参考。
    throw toNetworkError(error, fallbackMessage);
  }

  let body: EdgeFunctionBody | null = null;
  let parseError: unknown = null;
  try {
    body = (await response.json()) as EdgeFunctionBody;
  } catch (error) {
    parseError = error;
  }

  if (!response.ok) {
    const code = body?.code;
    const apiCode =
      (code ? (codeMap[code] ?? EDGE_CODE_TO_API[code]) : undefined)
      ?? httpStatusToCode(response.status);
    const message =
      body?.message?.trim()
      || (code ? codeMessages[code] : undefined)
      || httpStatusMessage(response.status)
      || `${fallbackMessage}，请稍后再试`;
    throw new ApiError(apiCode, message, { status: response.status, code, body });
  }

  if (body === null) {
    throw new ApiError(ApiErrorCode.UNKNOWN, `${fallbackMessage}：服务响应异常（HTTP ${response.status}）`, {
      status: response.status,
      cause: parseError,
    });
  }

  return body as T;
}

export interface EdgeFunctionRequestOptions extends PostJsonOptions {
  /** 是否携带当前登录态；公开接口（登录 / 注册）可传 false 只用 anon key。 */
  withSession?: boolean;
}

/** 调用 Supabase Edge Function：自动解析环境变量与登录态，再走 postJson 拦截。 */
export async function invokeEdgeFunction<T = EdgeFunctionBody>(
  name: string,
  body: unknown,
  options: EdgeFunctionRequestOptions = {},
): Promise<T> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const { withSession = true, ...postOptions } = options;

  let accessToken = anonKey;
  if (withSession) {
    try {
      const { data } = await getBrowserSupabase().auth.getSession();
      accessToken = data.session?.access_token ?? anonKey;
    } catch {
      // 会话读取失败不阻断：退回 anon key，由边缘函数按 401 归一化。
      accessToken = anonKey;
    }
  }

  return postJson<T>(
    `${url}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
    postOptions,
  );
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isNetworkFailure(error)) return toNetworkError(error, "数据请求失败");
  const source = error as Partial<PostgrestError> | null;
  const message = source?.message ?? (error instanceof Error ? error.message : String(error));
  if (!message) return new ApiError(ApiErrorCode.UNKNOWN, "数据请求失败，请稍后重试", error);
  if (source?.code === "42501") return new ApiError(ApiErrorCode.FORBIDDEN, message, error);
  if (source?.code === "23505") return new ApiError(ApiErrorCode.DUPLICATE_MONTH, message, error);
  if (source?.code === "23514" || source?.code === "22P02") return new ApiError(ApiErrorCode.INVALID_INPUT, message, error);
  return new ApiError(ApiErrorCode.UNKNOWN, message, error);
}

export function assertNoError(error: unknown): asserts error is null {
  if (error) throw normalizeError(error);
}

export function safeInteger(value: number, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new ApiError(ApiErrorCode.UNKNOWN, `${field} 超出安全整数范围`);
  return number;
}

export function monthToDate(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(ApiErrorCode.INVALID_INPUT, "月份格式必须为 YYYY-MM");
  return `${month}-01`;
}

export function dateToMonth(date: string): string {
  return date.slice(0, 7);
}

export function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function runApi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw normalizeError(error);
  }
}
