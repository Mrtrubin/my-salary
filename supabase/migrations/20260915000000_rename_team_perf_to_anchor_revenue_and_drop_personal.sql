-- 主播流水重构迁移：
-- 1. 将 team_performance_records 语义改名为 anchor_revenue_records（主播流水记录）；
-- 2. 删除个人绩效体系表 performance_records（个人上传功能整体下线）。
--
-- 背景：产品口径统一为「主播流水」，个人上传绩效功能废弃。团队每日绩效即主播流水记录，
-- 因此将 team_performance_records 更名为 anchor_revenue_records，并同步重命名其约束与索引；
-- 同时删除已无引用的个人绩效表 performance_records（其 RLS 策略、索引、外键随 cascade 一并清理）。

-- ============ 1. 重命名 team_performance_records -> anchor_revenue_records ============

alter table public.team_performance_records rename to anchor_revenue_records;

-- 重命名唯一约束（日期-成员-团队唯一 key）。
alter table public.anchor_revenue_records
  rename constraint team_performance_records_day_member_team_key
  to anchor_revenue_records_day_member_team_key;

-- 重命名索引。
alter index if exists public.team_performance_records_team_date_idx
  rename to anchor_revenue_records_team_date_idx;
alter index if exists public.team_performance_records_profile_idx
  rename to anchor_revenue_records_profile_idx;

-- 重建 RLS 策略：drop 旧名策略后按新表名重建（策略随表 rename 保留，但名称仍为旧名，统一重建以对齐语义）。
drop policy if exists team_perf_records_select on public.anchor_revenue_records;
drop policy if exists team_perf_records_insert on public.anchor_revenue_records;
drop policy if exists team_perf_records_update on public.anchor_revenue_records;

-- 读取：管理员全量；主持人读本团队；成员本人读自己的记录。
create policy anchor_revenue_records_select on public.anchor_revenue_records for select to authenticated
using (
  public.is_admin()
  or profile_id = public.current_profile_id()
  or exists (
    select 1 from public.teams t
    where t.id = anchor_revenue_records.team_id
      and t.host_profile_id = public.current_profile_id()
  )
);

-- 新增：管理员，或本团队主持人为「本团队内成员」录入。
create policy anchor_revenue_records_insert on public.anchor_revenue_records for insert to authenticated
with check (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    join public.team_members m on m.team_id = t.id
    where t.id = anchor_revenue_records.team_id
      and t.host_profile_id = public.current_profile_id()
      and m.profile_id = anchor_revenue_records.profile_id
  )
);

-- 修改：管理员全量；本团队主持人可直接更新本团队记录（重提交即更新）。
create policy anchor_revenue_records_update on public.anchor_revenue_records for update to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    where t.id = anchor_revenue_records.team_id
      and t.host_profile_id = public.current_profile_id()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    where t.id = anchor_revenue_records.team_id
      and t.host_profile_id = public.current_profile_id()
  )
);

-- ============ 2. 删除个人绩效表 performance_records ============
-- cascade 会一并清理其 RLS 策略、索引与外键依赖。
drop table if exists public.performance_records cascade;

-- 个人绩效审核状态枚举若已无其它引用则一并清理（team 表此前已去除 status 列）。
drop type if exists public.performance_status cascade;