"use client";

/**
 * 全局客户端 Provider（TanStack Query）。
 * 数据请求统一走 React Query，页面/组件不直接调用 SDK。
 */
import { useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { expireSession } from "@/lib/api/session";

/** 任意请求返回「登录态失效」时，统一清会话并回登录页，避免带失效 token 反复重试。 */
function handleQueryError(error: unknown) {
  if (error instanceof ApiError && error.code === ApiErrorCode.UNAUTHENTICATED) expireSession();
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleQueryError }),
        mutationCache: new MutationCache({ onError: handleQueryError }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}