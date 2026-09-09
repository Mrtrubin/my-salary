-- 绩效点类型:全局字典(如「音浪」「星光」),换算率为其自带的全局属性。
-- 换算规则:points_per_yuan 表示「多少绩效点 = 1 元」(如 10 音浪 = 1 元)。
-- 折算金额(分) = floor(点数 × 100 / points_per_yuan),向下取整到分。
-- 换算率与点数一律以正整数存储,避免浮点误差。
-- 团队通过 team_performance_points 关联表选择启用哪些绩效点类型(所有团队共用同一换算率)。

create table public.performance_points (
  id uuid primary key default gen_random_uuid(),
  -- 绩效点名称(全局唯一),如「音浪」。
  name text not null unique check (length(trim(name)) > 0),
  -- 多少绩效点 = 1 元。正整数,如 10 表示 10 音浪 = 1 元。
  points_per_yuan integer not null check (points_per_yuan > 0),
  status public.employment_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.performance_points enable row level security;

-- 全体登录用户可读绩效点字典;仅管理员可增删改。
create policy performance_points_select on public.performance_points for select to authenticated using (true);
create policy performance_points_insert on public.performance_points for insert to authenticated with check (public.is_admin());
create policy performance_points_update on public.performance_points for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy performance_points_delete on public.performance_points for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.performance_points to authenticated;
revoke all on public.performance_points from anon;

-- 团队↔绩效点类型 关联表:团队启用哪些绩效点类型。
create table public.team_performance_points (
  team_id uuid not null references public.teams(id) on delete cascade,
  point_id uuid not null references public.performance_points(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, point_id)
);
create index team_performance_points_point_id_idx on public.team_performance_points(point_id);

alter table public.team_performance_points enable row level security;

-- 管理员全量管理;主持人可读本团队关联的绩效点。
create policy team_performance_points_select on public.team_performance_points for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.teams t
      where t.id = team_performance_points.team_id
        and t.host_profile_id = public.current_profile_id()
    )
  );
create policy team_performance_points_insert on public.team_performance_points for insert to authenticated with check (public.is_admin());
create policy team_performance_points_delete on public.team_performance_points for delete to authenticated using (public.is_admin());

grant select, insert, delete on public.team_performance_points to authenticated;
revoke all on public.team_performance_points from anon;