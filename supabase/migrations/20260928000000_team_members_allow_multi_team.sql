-- 一个主播可以属于多个团队。
-- 原建表将 team_members.profile_id 设为全局唯一(一名主播仅属一个团队),
-- 现去掉该列级唯一约束;成员唯一性仍由复合主键 (team_id, profile_id) 保证,
-- 即同一主播在同一团队不重复,但可加入多个不同团队。

alter table public.team_members drop constraint if exists team_members_profile_id_key;