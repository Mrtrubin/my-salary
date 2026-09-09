/**
 * 后端适配器入口（占位）。
 * - 本人数据：走受 RLS 保护的 Supabase Data API 表读写。
 * - 授权/审核/规则/工资计算/确认/发布/冲正/敏感导出：走 RPC 或 Edge Function。
 *
 * 后续阶段将在此目录补充：
 *   dataApi.ts（Data API 适配）
 *   rpc.ts（RPC 适配）
 *   storage.ts（Storage 适配）
 *   edge.ts（Edge Function 适配）
 */
export {};