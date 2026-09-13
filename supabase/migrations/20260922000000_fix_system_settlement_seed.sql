-- 修复：确保 system_settlement_settings 单例行始终存在。
--
-- 根因：migration 20260917000000 在创建 guard trigger 之前 INSERT 初始行，
--   首次部署成功。但若远程数据库被 reset 后重新 push，guard trigger 已存在，
--   INSERT 会被 trigger 以 SYSTEM_SETTLEMENT_SINGLETON_IMMUTABLE 拒绝，
--   导致表为空 → 前端报 "系统结算配置不存在"。
--
-- 本 migration 幂等：仅当表为空时才插入，且通过临时禁用 trigger 绕过保护。

begin;

-- 仅在表完全为空时执行（已有的单例行不受影响）
do $$
begin
  if not exists (select 1 from public.system_settlement_settings where id) then
    -- 临时禁用 guard trigger 以允许初始 INSERT
    alter table public.system_settlement_settings disable trigger system_settlement_settings_guard;

    insert into public.system_settlement_settings (id, settlement_type, settlement_start_day)
    values (true, 'monthly', 1);

    -- 重新启用 guard trigger
    alter table public.system_settlement_settings enable trigger system_settlement_settings_guard;
  end if;
end $$;

commit;