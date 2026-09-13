-- 主播流水记录重新加回 host_profile_id(录入主持)。
--
-- 背景:迁移 20260914000000 曾删除该列(权限改由 teams.host_profile_id 关联判定)。
-- 现按产品要求重新加回,用于「留痕/展示录入主持」。
-- 权限策略保持不变(仍按 teams 关联判定,不依赖本列),故不改动 RLS。
--
-- 步骤:
--   1. 新增可空列 + 外键;
--   2. 回填历史记录:按 team_id 关联 teams.host_profile_id;
--   3. 加索引。

-- 1. 新增列(可空,允许历史团队主持缺失时为空)。
alter table public.anchor_revenue_records
  add column if not exists host_profile_id uuid references public.profiles(id) on delete set null;

-- 2. 回填:用记录所属团队当前主持兜底。
update public.anchor_revenue_records r
set host_profile_id = t.host_profile_id
from public.teams t
where r.team_id = t.id and r.host_profile_id is null;

-- 3. 索引。
create index if not exists anchor_revenue_records_host_idx
  on public.anchor_revenue_records(host_profile_id);