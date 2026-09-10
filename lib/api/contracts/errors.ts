/**
 * 统一业务错误码契约。不引用任何 Supabase SDK 类型。
 * 所有适配器需将底层错误归一化为这些错误码。
 */

export const ApiErrorCode = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  INVALID_INPUT: "INVALID_INPUT",
  SALARY_SCHEME_MISSING: "SALARY_SCHEME_MISSING",
  DUPLICATE_MONTH: "DUPLICATE_MONTH",
  RECORD_CONFIRMED: "RECORD_CONFIRMED",
  CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  FORMULA_ERROR: "FORMULA_ERROR",
  UNKNOWN: "UNKNOWN",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** 归一化后的业务错误。 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}