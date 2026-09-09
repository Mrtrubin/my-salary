create type public.system_role as enum ('admin', 'user');
create type public.employment_status as enum ('active', 'disabled');
create type public.performance_status as enum ('draft', 'pending', 'approved', 'rejected');
create type public.scheme_status as enum ('active', 'archived');
create type public.salary_record_status as enum ('draft', 'confirmed', 'published', 'voided');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  hire_date date not null,
  status public.employment_status not null default 'active',
  system_role public.system_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.positions (
  id bigint generated always as identity primary key,
  code text not null unique check (length(trim(code)) > 0),
  name text not null unique check (length(trim(name)) > 0),
  default_permissions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.user_positions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position_id bigint not null references public.positions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (profile_id, position_id)
);
create index user_positions_position_id_idx on public.user_positions(position_id);

create table public.salary_schemes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete restrict,
  position_id bigint references public.positions(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  version integer not null check (version > 0),
  base_salary_cents bigint not null check (base_salary_cents >= 0),
  guaranteed_salary_cents bigint not null check (guaranteed_salary_cents >= 0),
  threshold_multiplier_bps integer not null default 26500 check (threshold_multiplier_bps >= 0),
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  effective_from date not null,
  status public.scheme_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (name, version)
);
create index salary_schemes_profile_position_idx on public.salary_schemes(profile_id, position_id, effective_from desc);

create table public.performance_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  host_profile_id uuid references public.profiles(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  revenue_cents bigint not null check (revenue_cents >= 0),
  status public.performance_status not null default 'draft',
  reject_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, month)
);
create index performance_records_month_status_idx on public.performance_records(month desc, status);
create index performance_records_host_profile_id_idx on public.performance_records(host_profile_id);

create table public.salary_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  position_id bigint not null references public.positions(id) on delete restrict,
  scheme_id uuid references public.salary_schemes(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  revenue_cents bigint not null check (revenue_cents >= 0),
  tenure_month integer not null check (tenure_month > 0),
  threshold_cents bigint not null,
  is_qualified boolean not null,
  is_grace_period boolean not null,
  guaranteed_component_cents bigint not null,
  performance_component_cents bigint not null,
  gross_cents bigint not null,
  service_fee_cents bigint not null,
  net_cents bigint not null,
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  status public.salary_record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, position_id, month)
);
create index salary_records_month_status_idx on public.salary_records(month desc, status);
create index salary_records_position_id_idx on public.salary_records(position_id);

-- 以 security definer 运行:函数内部查询 profiles 时绕过 RLS,
-- 避免 profiles/user_positions 等策略反复调用本函数造成无限递归(54001 栈溢出)。
create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.profiles where auth_user_id = (select auth.uid()) $$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select system_role = 'admin' from public.profiles where auth_user_id = (select auth.uid())), false) $$;
revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.current_profile_id(), public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.positions enable row level security;
alter table public.user_positions enable row level security;
alter table public.salary_schemes enable row level security;
alter table public.performance_records enable row level security;
alter table public.salary_records enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (public.is_admin() or auth_user_id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy positions_select on public.positions for select to authenticated using (true);
create policy positions_admin_insert on public.positions for insert to authenticated with check (public.is_admin());
create policy positions_admin_update on public.positions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy user_positions_select on public.user_positions for select to authenticated using (public.is_admin() or profile_id = public.current_profile_id());
create policy user_positions_insert on public.user_positions for insert to authenticated with check (public.is_admin());
create policy user_positions_delete on public.user_positions for delete to authenticated using (public.is_admin());
create policy schemes_select on public.salary_schemes for select to authenticated using (public.is_admin() or profile_id = public.current_profile_id());
create policy schemes_insert on public.salary_schemes for insert to authenticated with check (public.is_admin());
create policy schemes_update on public.salary_schemes for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy performance_select on public.performance_records for select to authenticated using (public.is_admin() or profile_id = public.current_profile_id() or host_profile_id = public.current_profile_id());
create policy performance_insert on public.performance_records for insert to authenticated with check (public.is_admin() or host_profile_id = public.current_profile_id());
create policy performance_update on public.performance_records for update to authenticated using (public.is_admin() or (host_profile_id = public.current_profile_id() and status in ('draft', 'rejected'))) with check (public.is_admin() or (host_profile_id = public.current_profile_id() and status in ('draft', 'pending')));
create policy salary_records_select on public.salary_records for select to authenticated using (public.is_admin() or (profile_id = public.current_profile_id() and status = 'published'));
create policy salary_records_insert on public.salary_records for insert to authenticated with check (public.is_admin());
create policy salary_records_update on public.salary_records for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.positions to authenticated;
grant select, insert, delete on public.user_positions to authenticated;
grant select, insert, update on public.salary_schemes to authenticated;
grant select, insert, update on public.performance_records to authenticated;
grant select, insert, update on public.salary_records to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

insert into public.positions (code, name, default_permissions) values
  ('host', '主持', array['self.performance.read','self.payslip.read','anchor.performance.create','anchor.performance.update','team.performance.read']),
  ('anchor', '主播', array['self.performance.read','self.payslip.read']),
  ('dance', '舞蹈老师', array['self.performance.read','self.payslip.read']),
  ('makeup', '化妆师', array['self.performance.read','self.payslip.read']);
