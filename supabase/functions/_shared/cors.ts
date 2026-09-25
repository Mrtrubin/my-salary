/**
 * 浏览器调用 Edge Function 所需的 CORS 响应头（统一放这里，避免每个函数各抄一份）。
 *
 * 关键事实：Edge Functions **没有项目级的 CORS 开关**，网关不会替你补头，
 * 只能由函数自己在响应里带上；Data API（/rest/v1）与 Auth（/auth/v1）则本来就是全开
 * （Supabase 固定回 `access-control-allow-origin: *`），无需也无法配置。
 *
 * 因此每个对外函数必须做到两件事：
 *   1. `OPTIONS` 预检直接回这些头（浏览器不会给预检带 Authorization）；
 *   2. **所有**响应（含 4xx/5xx）都带 `Access-Control-Allow-Origin`，否则浏览器只会报
 *      「No 'Access-Control-Allow-Origin' header」，把真正的 404/401/500 盖掉，
 *      于是「函数没部署」看起来也像「没配 CORS」。
 *
 * Allow-Headers 取官方推荐清单（https://supabase.com/docs/guides/functions/cors），
 * 与 supabase-js 实际发送的请求头保持同步：x-retry-count 只在 postgrest-js 自动重试时出现，
 * traceparent/tracestate/baggage 只在客户端显式开启 trace propagation 时出现。
 * Allow-Methods 只列这些函数真正接受的 POST（非法方法由函数自己回 405）。
 *
 * 这里用 `*` 是安全的：本项目的函数一律靠 `Authorization: Bearer <用户 JWT>` 鉴权，
 * 不依赖 Cookie，因此不存在「通配 + 携带凭证」的 CSRF 面（切勿同时开 credentials: include）。
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
