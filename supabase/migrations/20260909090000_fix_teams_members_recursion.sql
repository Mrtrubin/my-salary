-- 修复:teams 与 team_members 的 SELECT 策略互相引用,导致
-- "infinite recursion detected in policy for relation \"teams\"" 报错。
--
-- 根因:
--   teams_select        -> exists(select from team_members ...)  查 team_members
--   team_members_select -> exists(select from teams ...)         又查 teams
-- 两条策略互相触发对方的 RLS 判断,形成无限递归。
--
-- 解决:参照 is_admin()/current_profile_id() 的做法,新增 security definer 函数
-- 在函数内部绕过 RLS 完成"当前用户是否属于/主持某团队"的判断,策略不再跨表 exists。

-- 当前用户(主播)所属团队 id;非成员返回 null。
create or replace function public.current_member_team_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.team_id
  from public.team_members m
  where m.profile_id = public.current_profile_id()
  limit 1
$$;

-- 判断某团队是否由当前用户主持。
create or replace function public.is_team_host(team_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.teams t
    where t.id = team_id
      and t.host_profile_id = public.current_profile_id()
  )
$$;

revoke all on function public.current_member_team_id() from public, anon;
revoke all on function public.is_team_host(uuid) from public, anon;
grant execute on function public.current_member_team_id(), public.is_team_host(uuid) to authenticated;

-- 重写 teams_select:不再直接 exists team_members,改用 security definer 函数。
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
using (
  public.is_admin()
  or host_profile_id = public.current_profile_id()
  or id = public.current_member_team_id()
);

-- 重写 team_members_select:不再直接 exists teams,改用 security definer 函数。
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select to authenticated
using (
  public.is_admin()
  or profile_id = public.current_profile_id()
  or public.is_team_host(team_members.team_id)
);