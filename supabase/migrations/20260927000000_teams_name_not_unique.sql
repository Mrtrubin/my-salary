-- 团队名称允许重复:唯一标识由 team_key 保证,name 仅作展示。
-- 去掉建表时对 teams.name 的唯一约束(默认命名 teams_name_key)。

alter table public.teams drop constraint if exists teams_name_key;

-- 保留非空与非空白校验(create table 内联 check 未单独命名,故不重复添加)。
-- 若历史 check 也被内联进 unique,此处不受影响;name 仍要求非空。
alter table public.teams alter column name set not null;