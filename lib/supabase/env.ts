/**
 * Supabase 环境变量读取与校验。
 * 仅暴露浏览器端安全变量；service_role 密钥禁止在此读取。
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `[env] 缺少环境变量 ${name}，请在 .env.local 中配置后重试。`
    );
  }
  return value;
}

/** 浏览器端可安全暴露的 Supabase 配置。 */
export function getPublicSupabaseEnv() {
  return {
    url: requireEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL
    ),
    anonKey: requireEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
  };
}