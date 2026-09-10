-- 修正团队业绩「每日仅保留最新一条」约束：按 (team_id, perf_date, profile_id) 维度作废。
--
-- 问题：原触发器 void_prior_team_performance 仅按 (team_id, perf_date) 作废，
-- 不区分 profile_id。主持人「重新提交」时一次性批量 insert 当日全部成员的 approved 记录，
-- AFTER INSERT FOR EACH ROW 触发器会让同批插入的各行互相作废，
-- 最终当天这批记录相互作废殆尽，几乎全部变成 voided（已作废）。
--
-- 修复：作废条件增加 profile_id 匹配，只作废「同一成员、同一日期」的旧 approved 记录，
-- 使「每日最新」约束真正按成员维度生效，同批不同成员的记录不再互相作废。

create or replace function public.void_prior_team_performance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 仅当新插入的是 approved 时才作废旧的同成员同日期 approved；
  -- draft/pending/rejected/voided 记录不参与，也不触发作废。
  if new.status = 'approved' then
    update public.team_performance_records
    set status = 'voided',
        updated_at = now()
    where team_id = new.team_id
      and perf_date = new.perf_date
      and profile_id = new.profile_id
      and status = 'approved'
      and id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_void_prior_team_performance on public.team_performance_records;
create trigger trg_void_prior_team_performance
  after insert on public.team_performance_records
  for each row execute function public.void_prior_team_performance();