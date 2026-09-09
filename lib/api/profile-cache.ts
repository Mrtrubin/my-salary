import type { Member } from "./data";

/**
 * 登录态（当前 profile）的本地持久化缓存。
 * 目的：让 useCurrentProfile 在组件挂载时可直接拿到 initialData，
 * 配合 staleTime: Infinity，避免每次切换路由都重新请求 profiles 接口。
 */
const STORAGE_KEY = "my-salary.current-profile";

export function readCachedProfile(): Member | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: Member | null): void {
  if (typeof window === "undefined") return;
  try {
    if (profile) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略序列化/配额错误 */
  }
}

export function clearCachedProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}