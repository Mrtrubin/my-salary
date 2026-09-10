-- 薪资状态变更历史（PLAN-001 阶段1）
--
-- 双写策略：主表 salary_records 存 4 个最新时间戳便于列表展示；
-- 本表存完整轨迹，每次状态转换插一条，支持某状态多次出现（可重入）的回溯。
-- created_at 精确到秒（timestamptz），前端展示按秒格式化。
create table public.salary_record_status_logs (
  id uuid primary key default gen_random_uuid(),
  salary_record_id uuid not null references public.salary_records(id) on delete cascade,
  from_status public.salary_record_status,
  to_status public.salary_record_status not null,
  operator_profile_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index salary_record_status_logs_record_idx
  on public.salary_record_status_logs(salary_record_id, created_at);

alter table public.salary_record_status_logs enable row level security;

-- 管理员读全量；成员读己方薪资记录的日志。
create policy salary_status_logs_select on public.salary_record_status_logs for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.salary_records r
      where r.id = salary_record_status_logs.salary_record_id
        and r.profile_id = public.current_profile_id()
    )
  );

-- 管理员可写（成员确认时经由主表策略触发的应用层写入亦以管理员/服务端为主）。
create policy salary_status_logs_insert on public.salary_record_status_logs for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.salary_records r
      where r.id = salary_record_status_logs.salary_record_id
        and r.profile_id = public.current_profile_id()
    )
  );

grant select, insert on public.salary_record_status_logs to authenticated;
revoke all on public.salary_record_status_logs from anon;