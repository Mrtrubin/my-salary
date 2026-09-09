/**
 * 浏览器端 Supabase 客户端（受 RLS 保护，使用匿名公钥）。
 * 注意：本模块仅供 API 适配层内部使用，页面/组件不得直接引用。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getPublicSupabaseEnv } from "./env";

let browserClient: SupabaseClient<Database> | null = null;

/** 获取（惰性单例）浏览器端 Supabase 客户端。 */
export function getBrowserSupabase(): SupabaseClient<Database> {
  if (!browserClient) {
    const { url, anonKey } = getPublicSupabaseEnv();
    browserClient = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return browserClient;
}