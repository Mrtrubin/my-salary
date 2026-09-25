-- 团队标识 team_key 改名为 team_code，并放开全局唯一（团队 ID 允许重复）。
--
-- 口径与原因：
--   1. 名称对齐：前端文案统一叫「团队 ID」，DB 列名随之改为 team_code
--      （teams.id 已是 uuid 主键，不能直接把该列叫 id）。
--   2. 一个主持可以带多个团，多个团可能共用同一个「团队 ID」
--      （同一抖音号 / 同一外部 anchor_id 下并行两个团），故 teams_team_key_key 唯一约束去掉。
--   3. 非空与去空白非空校验保留，只去掉唯一性。
--   4. 唯一约束去掉后，靠团队 ID 反查团队会有多行：daily-income Edge Function 已改为
--      按 teams.id(uuid) 精确定位并对该团队校验可见性，不再用 maybeSingle 按 ID 查，
--      因此重复 ID 不会把拉流水这条链路打断。
--
-- 注意：重命名列不会重写数据，历史行原样保留；外部流水上游仍按 anchor_id = 团队 ID 取数。

alter table public.teams rename column team_key to team_code;

-- 约束名跟着列名走，排障时能一眼看出对应列；唯一约束按新口径移除。
-- Postgres 的 RENAME CONSTRAINT 没有 IF EXISTS，用 DO 块兜住「约束名与预期不符」的情况，
-- 避免因历史差异让整条迁移失败。
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.teams'::regclass
      and conname = 'teams_team_key_not_blank'
  ) then
    execute 'alter table public.teams rename constraint teams_team_key_not_blank to teams_team_code_not_blank';
  end if;
end $$;

alter table public.teams drop constraint if exists teams_team_key_key;
