-- 站内通知（PLAN-001 阶段1）
--
-- 仅站内通知（无短信/邮件）。审核通过给成员发「工资条待确认」通知，
-- 成员在铃铛处查看并标记已读。写入以 service_role（Edge Function）与管理员为主。
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile_idx
  on public.notifications(profile_id, created_at desc);
create index notifications_unread_idx
  on public.notifications(profile_id) where read_at is null;

alter table public.notifications enable row level security;

-- 成员读己方通知；管理员读全量。
create policy notifications_select on public.notifications for select to authenticated
  using (public.is_admin() or profile_id = public.current_profile_id());

-- 成员可标记己方通知已读（仅更新 read_at）；管理员可写。
create policy notifications_update on public.notifications for update to authenticated
  using (public.is_admin() or profile_id = public.current_profile_id())
  with check (public.is_admin() or profile_id = public.current_profile_id());

-- 【重要】RLS 无法限制成员本次只改了 read_at，故用触发器强制：非管理员更新时，
-- 除 read_at 外的列必须保持不变，避免成员篡改 title/body/type/ref_id 等。
create or replace function public.guard_notification_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.profile_id is distinct from old.profile_id
     or new.type    is distinct from old.type
     or new.title   is distinct from old.title
     or new.body    is distinct from old.body
     or new.ref_id  is distinct from old.ref_id
     or new.created_at is distinct from old.created_at
  then
    raise exception '成员仅可更新通知的已读状态（read_at）';
  end if;
  return new;
end $$;

create trigger notifications_member_update_guard
  before update on public.notifications
  for each row execute function public.guard_notification_member_update();

-- 管理员可插入（服务端 service_role 绕过 RLS）。
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.is_admin());

grant select, insert, update on public.notifications to authenticated;
revoke all on public.notifications from anon;