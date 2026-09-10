-- 主播工资「保底优先模式 + 阶梯提成」改造
--
-- 规则变化：
--  - 提成改由固定阶梯计算（20% 起步，每 +1万 流水 +1%，最高 +5 点 → 25% 封顶），
--    不再需要方案上按人配置 commission_rate_bps → 从 salary_schemes 移除该列。
--  - 保底基准动态化：无责期(前3月)或上月达标 → 初始保底 base_salary_cents；
--    第 4 月起上月不达标 → 降级保底 guaranteed_salary_cents。
--    为可追溯，salary_records 新增 base_guarantee_cents（本月保底基准）与
--    commission_start_cents（提成起征流水）。
--  - salary_records.commission_rate_bps 保留，作为「本次阶梯实际采用提点」快照。

-- ---------- 1. 移除方案级提成配置 ----------
alter table public.salary_schemes
  drop column if exists commission_rate_bps;

-- ---------- 2. salary_records 新增保底基准与提成起征快照字段 ----------
alter table public.salary_records
  add column if not exists base_guarantee_cents bigint not null default 0,
  add column if not exists commission_start_cents bigint not null default 0;

-- ---------- 3. 重写团队周期结算 RPC（新增保底基准/提成起征字段落库） ----------
-- p_members 元素结构（与 Edge Function 输出对应）：
--   { profileId, positionId, schemeId, revenueCents, tenureMonth, baseGuaranteeCents,
--     thresholdCents, commissionStartCents, commissionRateBps, isQualified, isGracePeriod,
--     guaranteedComponentCents, performanceComponentCents, grossCents, serviceFeeCents, netCents }
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
      period_start, period_end, revenue_cents, tenure_month,
      base_guarantee_cents, threshold_cents, commission_start_cents, commission_rate_bps,
      is_qualified, is_grace_period, guaranteed_component_cents,
      performance_component_cents, gross_cents, service_fee_cents, net_cents,
      status, review_pending_at
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
      (m->>'baseGuaranteeCents')::bigint,
      (m->>'thresholdCents')::bigint,
      (m->>'commissionStartCents')::bigint,
      (m->>'commissionRateBps')::integer,
      (m->>'isQualified')::boolean,
      (m->>'isGracePeriod')::boolean,
      (m->>'guaranteedComponentCents')::bigint,
      (m->>'performanceComponentCents')::bigint,
      (m->>'grossCents')::bigint,
      (m->>'serviceFeeCents')::bigint,
      (m->>'netCents')::bigint,
      'pending_review',
      v_now
    )
    on conflict (team_id, profile_id, position_id, period_start, period_end)
    where team_id is not null and period_start is not null and period_end is not null
    do update set
      scheme_id = excluded.scheme_id,
      revenue_cents = excluded.revenue_cents,
      tenure_month = excluded.tenure_month,
      base_guarantee_cents = excluded.base_guarantee_cents,
      threshold_cents = excluded.threshold_cents,
      commission_start_cents = excluded.commission_start_cents,
      commission_rate_bps = excluded.commission_rate_bps,
      is_qualified = excluded.is_qualified,
      is_grace_period = excluded.is_grace_period,
      guaranteed_component_cents = excluded.guaranteed_component_cents,
      performance_component_cents = excluded.performance_component_cents,
      gross_cents = excluded.gross_cents,
      service_fee_cents = excluded.service_fee_cents,
      net_cents = excluded.net_cents,
      updated_at = v_now
    returning id, (xmax = 0) into v_record_id, v_inserted;

    -- 仅对本次新建的记录写「系统自动结算生成」日志。
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

-- ---------- 4. 重写驳回重算 RPC（新增保底基准/提成起征字段） ----------
create or replace function public.recompute_salary_record(
  p_id uuid,
  p_revenue_cents bigint,
  p_tenure_month integer,
  p_base_guarantee_cents bigint,
  p_threshold_cents bigint,
  p_commission_start_cents bigint,
  p_commission_rate_bps integer,
  p_is_qualified boolean,
  p_is_grace_period boolean,
  p_guaranteed_component_cents bigint,
  p_performance_component_cents bigint,
  p_gross_cents bigint,
  p_service_fee_cents bigint,
  p_net_cents bigint,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.salary_record_status;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;

  select status into v_status
  from public.salary_records
  where id = p_id
  for update;

  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION:%->pending_review', v_status using errcode = '22023';
  end if;

  update public.salary_records
  set revenue_cents = p_revenue_cents,
      tenure_month = p_tenure_month,
      base_guarantee_cents = p_base_guarantee_cents,
      threshold_cents = p_threshold_cents,
      commission_start_cents = p_commission_start_cents,
      commission_rate_bps = p_commission_rate_bps,
      is_qualified = p_is_qualified,
      is_grace_period = p_is_grace_period,
      guaranteed_component_cents = p_guaranteed_component_cents,
      performance_component_cents = p_performance_component_cents,
      gross_cents = p_gross_cents,
      service_fee_cents = p_service_fee_cents,
      net_cents = p_net_cents,
      status = 'pending_review',
      review_pending_at = v_now,
      updated_at = v_now
  where id = p_id;

  insert into public.salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review', 'pending_review', v_operator, coalesce(p_note, '管理员驳回，已按当前流水重新计算'));
end $$;

revoke all on function public.recompute_salary_record(uuid, bigint, integer, bigint, bigint, bigint, integer, boolean, boolean, bigint, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.recompute_salary_record(uuid, bigint, integer, bigint, bigint, bigint, integer, boolean, boolean, bigint, bigint, bigint, bigint, bigint, text) to authenticated;