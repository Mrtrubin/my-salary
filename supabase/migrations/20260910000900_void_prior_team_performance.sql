-- 团队业绩「每日仅保留最新一条」强制约束（数据库层，绕过 RLS）。
--
-- 问题：主持人重复提交同一团队同一日期业绩时，旧 approved 记录未被作废，
-- 导致结算聚合(loadRevenue 按 status='approved' 求和)把流水 double count。
-- 前端无法直接更新 approved 记录（RLS 仅允许主持人改 draft/rejected），
-- 故用 AFTER INSERT 触发器（security definer）在插入新的 approved 记录时，
-- 自动将同 (team_id, perf_date) 的其余 approved 记录置为 voided（作废），
-- 历史保留并以前端删除线展示，且不计入结算。

create or replace function public.void_prior_team_performance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 仅当新插入的是 approved 时才作废旧的同日期 approved；
  -- draft/pending/rejected/voided 记录不参与，也不触发作废。
  if new.status = 'approved' then
    update public.team_performance_records
    set status = 'voided',
        updated_at = now()
    where team_id = new.team_id
      and perf_date = new.perf_date
      and status = 'approved'
      and id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_void_prior_team_performance on public.team_performance_records;
create trigger trg_void_prior_team_performance
  after insert on public.team_performance_records
  for each row execute function public.void_prior_team_performance();