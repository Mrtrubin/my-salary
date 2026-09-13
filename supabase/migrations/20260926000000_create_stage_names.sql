-- 艺名管理:抖音号 -> 艺名 的一对一映射表。
-- 与主播账号解耦,仅管理员可增删改查。

create table public.stage_names (
  id uuid primary key default gen_random_uuid(),
  douyin_id text not null unique check (length(trim(douyin_id)) > 0),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stage_names_douyin_id_idx on public.stage_names(douyin_id);

-- updated_at 自动维护。
create or replace function public.touch_stage_names_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stage_names_set_updated_at
  before update on public.stage_names
  for each row execute function public.touch_stage_names_updated_at();

alter table public.stage_names enable row level security;

-- 读取:仅管理员。
create policy stage_names_select on public.stage_names for select to authenticated
using (public.is_admin());

-- 新增:仅管理员。
create policy stage_names_insert on public.stage_names for insert to authenticated
with check (public.is_admin());

-- 修改:仅管理员。
create policy stage_names_update on public.stage_names for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- 删除:仅管理员。
create policy stage_names_delete on public.stage_names for delete to authenticated
using (public.is_admin());

grant select, insert, update, delete on public.stage_names to authenticated;
revoke all on public.stage_names from anon;