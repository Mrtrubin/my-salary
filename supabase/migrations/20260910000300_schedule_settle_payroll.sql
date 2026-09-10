-- 自动结算定时任务（PLAN-001 阶段3）
--
-- 每日 00:05（数据库时区）触发 Edge Function settle-team-payroll 全量扫描：
-- 函数内部判定「当日 = 某团队周期第一天」且该周期尚未结算的团队，对刚结束的上一周期结算。
--
-- 依赖 Supabase 托管扩展 pg_cron（调度）+ pg_net（HTTP 调用 Edge Function）。
-- 项目 URL 与 service_role key 通过 Vault 读取，避免明文入库：
--   在 Supabase 控制台或 CLI 预先写入：
--     select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--     select vault.create_secret('<service_role_key>', 'service_role_key');
-- 若未配置 Vault，本迁移仅创建调度骨架，调用体从 Vault 取值；缺失时 cron 任务会报错但不影响其他迁移。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 幂等：先移除同名任务再创建。
do $$
begin
  perform cron.unschedule('settle-team-payroll-daily');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'settle-team-payroll-daily',
  '5 0 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/settle-team-payroll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer '
        || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      -- Edge Function 入口鉴权：cron 全量扫描需携带 x-cron-secret（与 Function 环境变量 SETTLE_CRON_SECRET 一致）。
      -- 请预先在 Vault 写入：select vault.create_secret('<随机长字符串>', 'settle_cron_secret');
      -- 并在 Edge Function 配置同值的环境变量 SETTLE_CRON_SECRET。
      'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'settle_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);