create type public.anchor_type as enum ('new', 'experienced');

alter table public.profiles
  add column anchor_type public.anchor_type not null default 'new',
  add column anchor_base_commission_bps integer not null default 2000;

alter table public.profiles
  add constraint profiles_anchor_base_commission_bps_check
  check (anchor_base_commission_bps between 1 and 10000);

comment on column public.profiles.anchor_type is '主播类型：new 新主播，experienced 老主播';
comment on column public.profiles.anchor_base_commission_bps is '主播基础提成率，单位基点，2000 = 20%';

grant usage on type public.anchor_type to authenticated;