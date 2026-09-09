-- 允许主持人读取其所带团队内成员的 profiles 记录。
-- 背景：原 profiles_select 仅允许 管理员 或 本人 读取；主持人端上传绩效页
-- 通过 team_members -> profiles 嵌套查询获取成员姓名时，profiles 被 RLS 过滤为 null，
-- 导致「选择团队成员」下拉为空。此策略补充主持人视角的读权限。
create policy profiles_select_host_members on public.profiles for select to authenticated
using (
  exists (
    select 1
    from public.teams t
    join public.team_members m on m.team_id = t.id
    where t.host_profile_id = public.current_profile_id()
      and m.profile_id = profiles.id
  )
);