import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { isNetworkFailure, postJson } from "@/lib/api/client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const catchError = (promise: Promise<unknown>): Promise<ApiError> =>
  promise.then(
    () => {
      throw new Error("期望请求失败，但实际成功");
    },
    (error) => error as ApiError,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("postJson：网络层失败不再笼统归为请求失败", () => {
  it("fetch 抛 TypeError(Failed to fetch) 时归一化为 NETWORK，并保留场景前缀", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await catchError(postJson("/x", {}, { fallbackMessage: "登录失败" }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(ApiErrorCode.NETWORK);
    expect(error.message).toContain("登录失败");
    expect(error.message).toContain("网络连接异常");
  });

  it("AbortError / 超时同样归一化为 NETWORK 且给出可读提示", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const error = await catchError(postJson("/x", {}));

    expect(error.code).toBe(ApiErrorCode.NETWORK);
    expect(error.message).toContain("取消或超时");
  });
});

describe("postJson：后端未返回 message 时由拦截器补齐", () => {
  it("有业务码无 message 时用 codeMessages 兜底", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: "USERNAME_TAKEN" }, 409));

    const error = await catchError(
      postJson("/x", {}, { fallbackMessage: "登录失败", codeMessages: { USERNAME_TAKEN: "该用户名已被占用" } }),
    );

    expect(error.code).toBe(ApiErrorCode.INVALID_INPUT);
    expect(error.message).toBe("该用户名已被占用");
  });

  it("既无业务码也无 message 时按 HTTP 状态兜底", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503));

    const error = await catchError(postJson("/x", {}, { fallbackMessage: "登录失败" }));

    expect(error.message).toBe("服务暂时不可用，请稍后重试");
  });

  it("网关返回非 JSON（502 HTML）时按 HTTP 状态兜底，不吞成成功", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>502</html>", { status: 502 }));

    const error = await catchError(postJson("/x", {}));

    expect(error.code).toBe(ApiErrorCode.UNKNOWN);
    expect(error.message).toContain("服务暂时不可用");
  });
});

describe("postJson：成功与异常响应", () => {
  it("2xx 且为 JSON 时原样返回 body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: "OK", access_token: "t" }));

    await expect(postJson<{ access_token?: string }>("/x", {})).resolves.toMatchObject({ access_token: "t" });
  });

  it("2xx 但响应不是合法 JSON 时抛服务响应异常", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not-json", { status: 200 }));

    const error = await catchError(postJson("/x", {}, { fallbackMessage: "登录失败" }));

    expect(error.message).toContain("服务响应异常");
  });
});

describe("isNetworkFailure：区分网络层与业务错误", () => {
  it("识别 PostgREST 空 code 的网络失败", () => {
    expect(isNetworkFailure({ code: "", message: "TypeError: Failed to fetch" })).toBe(true);
  });

  it("不误伤带业务码的 Postgres 错误", () => {
    expect(isNetworkFailure({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isNetworkFailure({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
