/**
 * 登录态失效的统一收口。
 *
 * 独立成模块，供 API 客户端（client）与 auth 复用，避免 auth <-> client 循环依赖。
 * 触发场景：任意「带登录态」的请求返回 UNAUTHENTICATED（会话被撤销 / token 过期）。
 */
import { getBrowserSupabase } from "@/lib/supabase/client";
import { clearCachedProfile } from "@/lib/api/profile-cache";

/** 只触发一次跳转的并发保护（多个请求同时 401 时避免重复跳转）。 */
let expiring = false;

/**
 * 清本地会话与缓存并回到登录页。只登出本设备，不影响其他设备。
 */
export function expireSession(): void {
  if (expiring || typeof window === "undefined") return;
  expiring = true;
  clearCachedProfile();
  // local 登出只清本地存储，不再调服务端（token 已失效，调了也会失败）。
  void getBrowserSupabase()
    .auth.signOut({ scope: "local" })
    .catch(() => undefined)
    .finally(() => {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      window.location.replace(`${basePath}/login/`);
    });
}
