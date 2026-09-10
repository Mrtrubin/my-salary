-- 手动全量核算（recheck）支持：settle_team_period 增加 p_force 重算开关。
--
-- 原 settle_team_period 的防倒退检查（v_last_end >= p_period_end 直接返回 0）是为
-- 「自动结算推进游标」服务的幂等去重。但手动全量核算需要补算/重算历史周期：
--   * 补算：last_settled_period_end 之后尚未结算的周期；
--   * 重算：业绩(team_performance_records)在结算后又被修改/补提，导致该周期工资需按最新流水重算。
-- p_force=true 时绕过防倒退短路，允许对「已结算但业绩有变更」的周期原地重算（金额 upsert 覆盖），
-- 回退判断仍保留：force 重算只更新金额，不把 last_settled_period_end 倒退（仅向前推进）。

create or replace function public.settle_team_period(
  p_team_id uuid,
  p_period_start date,
  p_period_end date,
  p_members jsonb,
  p_force boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_end date;
  v_month date := date_trunc('month', p_period_start)::date;
  v_now timestamptz := now();
  v_count integer := 0;
  m jsonb;
  v_record_id uuid;
  v_inserted boolean;
begin
  -- 行锁团队，串行化同一团队并发结算。
  select last_settled_period_end into v_last_end
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 幂等 + 防倒退：该周期已结算，或游标已推进到更晚周期，则跳过。
  -- 仅当 p_force=false（自动/常规结算）时短路；force 重算允许覆盖已结算周期。
  if not p_force and v_last_end is not null and v_last_end >= p_period_end then
    return 0;
  end if;

  for m in select * from jsonb_array_elements(p_members)
  loop
    insert into public.salary_records (
      profile_id, position_id, scheme_id, month, team_id,
      period_start, period_end, revenue_cents, tenure_month, threshold_cents,
      is_qualified, is_grace_period, guaranteed_component_cents,
      performance_component_cents, gross_cents, service_fee_cents, net_cents,
      commission_rate_bps, status, review_pending_at
    ) values (
      (m->>'profileId')::uuid,
      (m->>'positionId')::bigint,
      nullif(m->>'schemeId','')::uuid,
      v_month,
      p_team_id,
      p_period_start,
      p_period_end,
      (m->>'revenueCents')::bigint,
      (m->>'tenureMonth')::integer,
      (m->>'thresholdCents')::bigint,
      (m->>'isQualified')::boolean,
      (m->>'isGracePeriod')::boolean,
      (m->>'guaranteedComponentCents')::bigint,
      (m->>'performanceComponentCents')::bigint,
      (m->>'grossCents')::bigint,
      (m->>'serviceFeeCents')::bigint,
      (m->>'netCents')::bigint,
      (m->>'commissionRateBps')::integer,
      'pending_review',
      v_now
    )
    on conflict (team_id, profile_id, position_id, period_start, period_end)
    where team_id is not null and period_start is not null and period_end is not null
    do update set
      scheme_id = excluded.scheme_id,
      revenue_cents = excluded.revenue_cents,
      tenure_month = excluded.tenure_month,
      threshold_cents = excluded.threshold_cents,
      is_qualified = excluded.is_qualified,
      is_grace_period = excluded.is_grace_period,
      guaranteed_component_cents = excluded.guaranteed_component_cents,
      performance_component_cents = excluded.performance_component_cents,
      gross_cents = excluded.gross_cents,
      service_fee_cents = excluded.service_fee_cents,
      net_cents = excluded.net_cents,
      commission_rate_bps = excluded.commission_rate_bps,
      updated_at = v_now
    returning id, (xmax = 0) into v_record_id, v_inserted;

    -- 仅对本次新建的记录写「系统自动结算生成」日志，避免重试/重算时重复插日志。
    if v_inserted then
      insert into public.salary_record_status_logs
        (salary_record_id, from_status, to_status, operator_profile_id, note)
      values (v_record_id, null, 'pending_review', null, '系统自动结算生成');
    end if;

    v_count := v_count + 1;
  end loop;

  -- 推进结算游标（只前进不倒退）：仅当本周期晚于已记录游标时更新。
  if v_last_end is null or v_last_end < p_period_end then
    update public.teams
    set last_settled_period_end = p_period_end
    where id = p_team_id;
  end if;

  return v_count;
end $$;

revoke all on function public.settle_team_period(uuid, date, date, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.settle_team_period(uuid, date, date, jsonb, boolean) to service_role;