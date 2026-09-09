-- 允许普通成员（主播）读取自己所属团队的 teams 记录。
-- 背景：原 teams_select 仅允许 管理员 或 主持人 读取；主播端业绩页
-- 通过 team_performance_records -> teams 嵌套查询获取团队名称时，teams 被 RLS 过滤为 null，
-- 导致「团队名称」显示为占位符「团队」。此策略补充成员视角的读权限。
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
using (
  public.is_admin()
  or host_profile_id = public.current_profile_id()
  or exists (
    select 1 from public.team_members m
    where m.team_id = teams.id
      and m.profile_id = public.current_profile_id()
  )
);