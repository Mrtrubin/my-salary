-- 团队实体:1 团队含 1 主持人 + 若干主播。
-- 复用 profiles(成员) / positions(host/anchor 岗位) / performance_records(流水记录)。

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  host_profile_id uuid not null unique references public.profiles(id) on delete restrict,
  status public.employment_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 团队成员(仅主播);一名主播仅属一个团队,故 profile_id 全局唯一。
create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index team_members_profile_id_idx on public.team_members(profile_id);
create index teams_host_profile_id_idx on public.teams(host_profile_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- 团队:管理员全量管理;主持人可读本团队。
create policy teams_select on public.teams for select to authenticated
  using (public.is_admin() or host_profile_id = public.current_profile_id());
create policy teams_insert on public.teams for insert to authenticated
  with check (public.is_admin());
create policy teams_update on public.teams for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy teams_delete on public.teams for delete to authenticated
  using (public.is_admin());

-- 团队成员:管理员全量管理;主持人可读本团队成员;成员本人可读自己所属。
create policy team_members_select on public.team_members for select to authenticated
  using (
    public.is_admin()
    or profile_id = public.current_profile_id()
    or exists (
      select 1 from public.teams t
      where t.id = team_members.team_id
        and t.host_profile_id = public.current_profile_id()
    )
  );
create policy team_members_insert on public.team_members for insert to authenticated
  with check (public.is_admin());
create policy team_members_delete on public.team_members for delete to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, delete on public.team_members to authenticated;
revoke all on public.teams from anon;
revoke all on public.team_members from anon;

-- 强化流水录入:主持人仅能为本团队内的主播录入/修改流水(替换原基于 host_profile_id 的策略)。
drop policy if exists performance_insert on public.performance_records;
drop policy if exists performance_update on public.performance_records;
create policy performance_insert on public.performance_records for insert to authenticated
  with check (
    public.is_admin()
    or (
      host_profile_id = public.current_profile_id()
      and exists (
        select 1 from public.teams t
        join public.team_members m on m.team_id = t.id
        where t.host_profile_id = public.current_profile_id()
          and m.profile_id = performance_records.profile_id
      )
    )
  );
create policy performance_update on public.performance_records for update to authenticated
  using (
    public.is_admin()
    or (host_profile_id = public.current_profile_id() and status in ('draft', 'rejected'))
  )
  with check (
    public.is_admin()
    or (
      host_profile_id = public.current_profile_id()
      and status in ('draft', 'pending')
      and exists (
        select 1 from public.teams t
        join public.team_members m on m.team_id = t.id
        where t.host_profile_id = public.current_profile_id()
          and m.profile_id = performance_records.profile_id
      )
    )
  );