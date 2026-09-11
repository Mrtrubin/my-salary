-- 仅保留管理员手动结算；不删除历史工资、日志或旧游标数据。
begin;

-- 同时覆盖标准任务名和其他调用旧入口的调度，不影响无关任务。
do $$
declare v_job record;
begin
  if to_regclass('cron.job') is not null then
    for v_job in
      select jobid from cron.job
      where jobname = 'settle-team-payroll-daily'
         or command like '%/functions/v1/settle-team-payroll%'
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;
  end if;
end $$;

-- 将原手动分支收敛为唯一入口：保留管理员鉴权、系统锁、周期及状态保护。
create or replace function public.settle_anchor_revenue(
  p_team_id uuid, p_period_start date, p_period_end date, p_members jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.system_settlement_settings%rowtype;
  m jsonb;
  v_profile_id uuid;
  v_position_id bigint;
  v_record_id uuid;
  v_status public.salary_record_status;
  v_inserted boolean;
  v_count integer := 0;
  v_operator uuid;
  v_now timestamptz := now();
  v_adjustments jsonb;
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  v_operator := public.current_profile_id();

  select * into s from public.system_settlement_settings where id for update;
  if not found then raise exception 'SYSTEM_SETTLEMENT_SETTINGS_MISSING'; end if;
  -- 改变行版本，让旧事务快照的并发请求安全失败并重试。
  update public.system_settlement_settings set updated_at = updated_at where id;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end) then
    raise exception 'INVALID_SETTLEMENT_PERIOD' using errcode = '22023';
  end if;
  if extract(day from p_period_start)::integer <>
       (case when s.settlement_type = 'monthly' then 1 else s.settlement_start_day end)
     or p_period_end <> (p_period_start + interval '1 month')::date - 1 then
    raise exception 'SETTLEMENT_PERIOD_MUST_MATCH_SYSTEM' using errcode = '22023';
  end if;
  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'INVALID_SETTLEMENT_MEMBERS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) x
   where jsonb_typeof(x) <> 'object'
       or nullif(x->>'profileId', '') is null or nullif(x->>'positionId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_MEMBER' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) x
    group by (x->>'profileId')::uuid, (x->>'positionId')::bigint having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_MEMBER_POSITION' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_members)
  loop
    v_profile_id := (m->>'profileId')::uuid;
    v_position_id := (m->>'positionId')::bigint;
    select id, status into v_record_id, v_status from public.salary_records
    where profile_id = v_profile_id and position_id = v_position_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
    end if;
    v_adjustments := coalesce(nullif(m->'adjustments', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(v_adjustments) <> 'array' then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;

    -- 已有精确周期走 UPDATE；其他重叠周期仍由既有触发器拒绝。
    -- 工资按成员、岗位、周期保存，团队仅用于名单筛选。
    if v_inserted then
      insert into public.salary_records (
        profile_id, position_id, scheme_id, month, team_id, period_start, period_end,
        revenue_cents, tenure_month, base_guarantee_cents, threshold_cents,
        commission_start_cents, commission_rate_bps, is_qualified, is_grace_period,
        guaranteed_component_cents, performance_component_cents, gross_cents,
        service_fee_cents, net_cents, adjustments, status, review_pending_at
      ) values (
        v_profile_id, v_position_id, nullif(m->>'schemeId', '')::uuid,
        date_trunc('month', p_period_start)::date, null, p_period_start, p_period_end,
        (m->>'revenueCents')::bigint, (m->>'tenureMonth')::integer,
        (m->>'baseGuaranteeCents')::bigint, (m->>'thresholdCents')::bigint,
        (m->>'commissionStartCents')::bigint, (m->>'commissionRateBps')::integer,
        (m->>'isQualified')::boolean, (m->>'isGracePeriod')::boolean,
        (m->>'guaranteedComponentCents')::bigint, (m->>'performanceComponentCents')::bigint,
        (m->>'grossCents')::bigint, (m->>'serviceFeeCents')::bigint, (m->>'netCents')::bigint,
        v_adjustments, 'pending_review'::public.salary_record_status, v_now
      ) returning id into v_record_id;
    else
      update public.salary_records set
        team_id = null,
        scheme_id = nullif(m->>'schemeId', '')::uuid,
        revenue_cents = (m->>'revenueCents')::bigint,
        tenure_month = (m->>'tenureMonth')::integer,
        base_guarantee_cents = (m->>'baseGuaranteeCents')::bigint,
        threshold_cents = (m->>'thresholdCents')::bigint,
        commission_start_cents = (m->>'commissionStartCents')::bigint,
        commission_rate_bps = (m->>'commissionRateBps')::integer,
        is_qualified = (m->>'isQualified')::boolean,
        is_grace_period = (m->>'isGracePeriod')::boolean,
        guaranteed_component_cents = (m->>'guaranteedComponentCents')::bigint,
        performance_component_cents = (m->>'performanceComponentCents')::bigint,
        gross_cents = (m->>'grossCents')::bigint,
        service_fee_cents = (m->>'serviceFeeCents')::bigint,
        net_cents = (m->>'netCents')::bigint,
        adjustments = v_adjustments,
        status = 'pending_review'::public.salary_record_status,
        review_pending_at = v_now, updated_at = v_now
      where id = v_record_id;
    end if;
    insert into public.salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when v_inserted then '管理员手动结算生成'
           else '管理员手动重新结算（含调整项）' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- 移除所有旧自动结算入口，包括四参重载和包含自动分支的内部函数。
-- 不使用 CASCADE，避免误删其他数据库对象；异常时整个迁移回滚。
drop function if exists public.settle_team_period(uuid, date, date, jsonb);
drop function if exists public.settle_team_period(uuid, date, date, jsonb, boolean);
drop function if exists public.write_system_settlement(uuid, date, date, jsonb, boolean);

revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb) to authenticated;

-- 旧游标仅保留历史值，不再允许 API 角色推进。
revoke update (last_settled_period_end) on public.system_settlement_settings from service_role;
create or replace function public.guard_system_settlement_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' or new.id is distinct from old.id then
    raise exception 'SYSTEM_SETTLEMENT_SINGLETON_IMMUTABLE' using errcode = '42501';
  end if;
  if (new.settlement_type, new.settlement_start_day)
     is distinct from (old.settlement_type, old.settlement_start_day) then
    if public.is_admin() is not true then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
    if new.settlement_type = 'monthly' then new.settlement_start_day := 1; end if;
  end if;
  if new.last_settled_period_end is distinct from old.last_settled_period_end then
    raise exception 'AUTOMATIC_SETTLEMENT_DISABLED' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
commit;