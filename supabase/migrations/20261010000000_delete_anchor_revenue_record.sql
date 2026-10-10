-- 流水记录删除（/admin/team-review 操作列）。
--
-- 需求：管理员在流水记录页删除单条主播流水，删除后给上传者（该记录录入主持 host_profile_id）
-- 发一条站内通知。删除与通知需原子完成，且仅限管理员操作。
--
-- 实现：security definer RPC 在单事务内先取记录归属信息（团队名/成员名/日期/上传者），
-- 再删除记录，最后给上传者插入站内通知；非管理员直接拒绝。
-- 权限收敛在本函数，不新增 RLS delete 策略（写入仅经此 RPC）。

create or replace function public.delete_anchor_revenue_record(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_profile_id uuid;
  v_perf_date date;
  v_team_name text;
  v_profile_name text;
begin
  if public.is_admin() is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select r.host_profile_id,
         r.perf_date,
         t.name,
         p.name
    into v_host_profile_id, v_perf_date, v_team_name, v_profile_name
    from public.anchor_revenue_records r
    left join public.teams t on t.id = r.team_id
    left join public.profiles p on p.id = r.profile_id
   where r.id = p_id;

  if not found then
    return;
  end if;

  delete from public.anchor_revenue_records where id = p_id;

  if v_host_profile_id is not null then
    insert into public.notifications (profile_id, type, title, body, ref_id)
    values (
      v_host_profile_id,
      'anchor_revenue_deleted',
      '流水记录被删除',
      format(
        '您录入的「%s」%s 成员「%s」的流水记录已被管理员删除。',
        coalesce(v_team_name, '未知团队'),
        v_perf_date,
        coalesce(v_profile_name, '未知成员')
      ),
      p_id
    );
  end if;
end $$;

revoke all on function public.delete_anchor_revenue_record(uuid) from public, anon;
grant execute on function public.delete_anchor_revenue_record(uuid) to authenticated;
