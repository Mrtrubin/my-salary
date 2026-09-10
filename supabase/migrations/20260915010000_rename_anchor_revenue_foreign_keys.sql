-- 补丁：重命名 anchor_revenue_records 的外键约束名（幂等）。
--
-- 背景：上一迁移用 alter table ... rename to 将 team_performance_records 改名为
-- anchor_revenue_records，但 rename table 不会重命名其列级外键约束。原外键为建表时
-- 内联定义、由 Postgres 自动命名（team_performance_records_<col>_fkey）。
-- PostgREST 依赖外键约束名做关系嵌入消歧（profiles 被 profile_id 与 host_profile_id
-- 双重引用），代码里用的关系名是 anchor_revenue_records_profile_id_fkey，
-- 与库中实际的 team_performance_records_profile_id_fkey 不一致，导致：
--   "Could not find a relationship between 'anchor_revenue_records' and 'profiles'"。
-- 此迁移统一将各外键约束改为 anchor_revenue_records_<col>_fkey。
-- 使用 DO 块判断旧约束是否存在，保证可重复执行且不因约束不存在报错。

do $$
declare
  cols text[] := array['team_id', 'host_profile_id', 'profile_id', 'point_id', 'reviewed_by'];
  col text;
  old_name text;
  new_name text;
begin
  foreach col in array cols loop
    old_name := 'team_performance_records_' || col || '_fkey';
    new_name := 'anchor_revenue_records_' || col || '_fkey';
    if exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'anchor_revenue_records'
        and c.conname = old_name
    ) then
      execute format(
        'alter table public.anchor_revenue_records rename constraint %I to %I',
        old_name, new_name
      );
    end if;
  end loop;
end $$;