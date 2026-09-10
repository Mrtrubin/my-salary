-- 团队每日绩效改造：去掉审核状态体系与主持字段，改为「按天+成员+团队」唯一记录。
--
-- 背景：team_performance_records 原设计带 status（审核/驳回/作废）与 host_profile_id（录入主持人）。
-- 新口径下不再需要审核流转：主持人重新提交时直接「更新」同 (perf_date, profile_id, team_id) 的记录，
-- 而不是插入新行再作废旧行。因此：
--   1. 删除审核相关列：status / reject_reason / submitted_at / reviewed_at / reviewed_by；
--   2. 删除 host_profile_id 列（权限改由 teams.host_profile_id 关联判定）；
--   3. 建立 (team_id, perf_date, profile_id) 唯一约束，配合应用层 upsert 实现「重提交即更新」；
--   4. 删除 void_prior_team_performance 触发器与函数（不再有作废概念）；
--   5. 重建 RLS 策略，去除对 status / 本表 host_profile_id 的依赖。

-- 1. 删除「每日仅保留最新一条」的作废触发器与函数（依赖 status，已无意义）。
drop trigger if exists trg_void_prior_team_performance on public.team_performance_records;
drop function if exists public.void_prior_team_performance();

-- 2. 清理历史重复：同一 (team_id, perf_date, profile_id) 仅保留最新一条，
--    否则新增唯一约束会失败。优先保留 approved / updated_at 最新的记录。
with ranked as (
  select
    id,
    row_number() over (
      partition by team_id, perf_date, profile_id
      order by
        case when status = 'approved' then 0 else 1 end,
        updated_at desc,
        created_at desc
    ) as rn
  from public.team_performance_records
)
delete from public.team_performance_records t
using ranked r
where t.id = r.id and r.rn > 1;

-- 3. 删除审核相关列与主持字段。
--    先删除依赖 status / host_profile_id 的旧 RLS 策略，否则 DROP COLUMN 会因依赖报错。
drop policy if exists team_perf_records_select on public.team_performance_records;
drop policy if exists team_perf_records_insert on public.team_performance_records;
drop policy if exists team_perf_records_update on public.team_performance_records;

drop index if exists public.team_performance_records_status_idx;
drop index if exists public.team_performance_records_host_idx;

alter table public.team_performance_records
  drop column if exists status,
  drop column if exists reject_reason,
  drop column if exists submitted_at,
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists host_profile_id;

-- 4. 建立唯一约束：日期-成员-团队为唯一 key，支撑应用层 upsert。
alter table public.team_performance_records
  add constraint team_performance_records_day_member_team_key
  unique (team_id, perf_date, profile_id);

-- 5. 重建 RLS 策略：去除对 status 与本表 host_profile_id 的依赖，改用 teams.host_profile_id 判定主持人。

-- 读取：管理员全量；主持人读本团队；成员本人读自己的记录。
create policy team_perf_records_select on public.team_performance_records for select to authenticated
using (
  public.is_admin()
  or profile_id = public.current_profile_id()
  or exists (
    select 1 from public.teams t
    where t.id = team_performance_records.team_id
      and t.host_profile_id = public.current_profile_id()
  )
);

-- 新增：管理员，或本团队主持人为「本团队内成员」录入。
create policy team_perf_records_insert on public.team_performance_records for insert to authenticated
with check (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    join public.team_members m on m.team_id = t.id
    where t.id = team_performance_records.team_id
      and t.host_profile_id = public.current_profile_id()
      and m.profile_id = team_performance_records.profile_id
  )
);

-- 修改：管理员全量；本团队主持人可直接更新本团队记录（重提交即更新）。
create policy team_perf_records_update on public.team_performance_records for update to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    where t.id = team_performance_records.team_id
      and t.host_profile_id = public.current_profile_id()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    where t.id = team_performance_records.team_id
      and t.host_profile_id = public.current_profile_id()
  )
);