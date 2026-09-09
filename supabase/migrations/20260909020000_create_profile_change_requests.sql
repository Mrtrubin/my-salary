-- 成员资料修改申请（字段级审核）。
-- 成员可批量提交对自己 name/phone/email/id_card 的修改，逐字段独立审核，通过后才落库到 profiles。
-- 关键规则：同一 profile+field 同时只允许 1 条 pending；成员重复提交同字段时，旧 pending 置为 superseded（由 Edge Function 以 service role 事务完成）。

create type public.change_request_status as enum ('pending', 'approved', 'rejected', 'superseded');

create table public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  field text not null check (field in ('name', 'phone', 'email', 'id_card')),
  old_value text,
  new_value text,
  status public.change_request_status not null default 'pending',
  batch_id uuid not null,
  reject_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pcr_profile_status_idx on public.profile_change_requests(profile_id, status);
create index pcr_status_created_idx on public.profile_change_requests(status, created_at desc);

-- 同一 profile+field 只允许 1 条 pending：保证字段级申请的唯一在途性。
create unique index pcr_one_pending_per_field
  on public.profile_change_requests(profile_id, field) where status = 'pending';

alter table public.profile_change_requests enable row level security;

-- 成员看自己的申请，管理员看全部。
create policy pcr_select on public.profile_change_requests
  for select to authenticated
  using (public.is_admin() or profile_id = public.current_profile_id());

-- 仅本人可提交自己的 pending 申请（覆盖旧 pending 的作废由 Edge Function service role 完成）。
create policy pcr_insert on public.profile_change_requests
  for insert to authenticated
  with check (profile_id = public.current_profile_id() and status = 'pending');

-- 审核（approve/reject）仅管理员；落库到 profiles 仍受 profiles_update（仅 admin）约束，故实际走 Edge Function。
create policy pcr_update on public.profile_change_requests
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.profile_change_requests to authenticated;
revoke all on public.profile_change_requests from anon;