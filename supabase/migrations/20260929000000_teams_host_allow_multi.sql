-- 一个主持人可以带多个团队。
-- 原建表将 teams.host_profile_id 设为 unique(一名主持仅一个团队),
-- 与「主播可属多团队」一致,主持也应能带多个团队,故去掉该唯一约束。
-- 保留外键与非空约束;保留 teams_host_profile_id_idx 索引用于查询。

alter table public.teams drop constraint if exists teams_host_profile_id_key;