-- 团队绩效记录：主持人以「团队 + 单日 + 总开播时长」为一次批次，
-- 为团队内每名成员各录一条当日绩效。区别于个人版 performance_records：
--   1. 精确到日（perf_date），允许一人一天多条（不同绩效点）
--   2. 携带团队维度字段：team_id、broadcast_minutes（总开播时长，分钟）
--   3. 支持「无绩效/停播」：no_perf=true 时用 no_perf_note 记录任意文本（≤20 字符）
create table public.team_performance_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  host_profile_id uuid not null references public.profiles(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  point_id uuid references public.performance_points(id) on delete restrict,
  perf_date date not null,
  broadcast_minutes integer not null default 0 check (broadcast_minutes >= 0),
  points_amount integer not null default 0 check (points_amount >= 0),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  no_perf boolean not null default false,
  no_perf_note text check (no_perf_note is null or length(no_perf_note) <= 20),
  status public.performance_status not null default 'pending',
  reject_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index team_performance_records_team_date_idx on public.team_performance_records(team_id, perf_date desc);
create index team_performance_records_profile_idx on public.team_performance_records(profile_id);
create index team_performance_records_host_idx on public.team_performance_records(host_profile_id);
create index team_performance_records_status_idx on public.team_performance_records(status);

alter table public.team_performance_records enable row level security;

-- 读取：管理员全量；主持人读本团队；成员本人读自己的记录。
create policy team_perf_records_select on public.team_performance_records for select to authenticated
using (
  public.is_admin()
  or host_profile_id = public.current_profile_id()
  or profile_id = public.current_profile_id()
);

-- 新增：管理员，或主持人为「本团队内成员」录入。
create policy team_perf_records_insert on public.team_performance_records for insert to authenticated
with check (
  public.is_admin()
  or (
    host_profile_id = public.current_profile_id()
    and exists (
      select 1 from public.teams t
      join public.team_members m on m.team_id = t.id
      where t.id = team_performance_records.team_id
        and t.host_profile_id = public.current_profile_id()
        and m.profile_id = team_performance_records.profile_id
    )
  )
);

-- 修改：管理员全量；主持人仅在 draft/rejected 时可改本团队记录。
create policy team_perf_records_update on public.team_performance_records for update to authenticated
using (
  public.is_admin()
  or (host_profile_id = public.current_profile_id() and status in ('draft', 'rejected'))
)
with check (
  public.is_admin()
  or (host_profile_id = public.current_profile_id() and status in ('draft', 'pending'))
);

grant select, insert, update, delete on public.team_performance_records to authenticated;
revoke all on public.team_performance_records from anon;