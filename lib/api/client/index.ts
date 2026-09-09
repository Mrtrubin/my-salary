import type { PostgrestError } from "@supabase/supabase-js";
import { ApiError, ApiErrorCode } from "../contracts/errors";

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const source = error as Partial<PostgrestError> | null;
  const message = source?.message ?? (error instanceof Error ? error.message : String(error));
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
