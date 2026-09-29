-- 主播服务率改为「手动按人配置」：服务费 = ceil(实发收益 × 服务率)。
--
-- 1) salary_schemes 增加 service_fee_rate_bps（主播工资方案手工配置，默认 3%）；
-- 2) salary_records 增加 service_fee_rate_bps（结算/重算时的费率快照，供工资条展示）；
-- 3) settle_anchor_revenue / recompute_salary_record 改用方案上的服务率，不再硬编码 300。
begin;

alter table public.salary_schemes
  add column if not exists service_fee_rate_bps integer not null default 300
  check (service_fee_rate_bps between 0 and 10000);

alter table public.salary_records
  add column if not exists service_fee_rate_bps integer not null default 300
  check (service_fee_rate_bps between 0 and 10000);

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
  v_adj_total bigint;
  v_att_bps integer;
  v_dy_bps integer;
  v_scheme public.salary_schemes%rowtype;
  v_hire_date date;
  v_base_commission_bps integer;
  v_tenure integer;
  v_revenue bigint;
  v_broadcast integer;
  v_note text;
  d public.anchor_payroll_detail;
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  v_operator := public.current_profile_id();

  select * into s from public.system_settlement_settings where id for update;
  if not found then raise exception 'SYSTEM_SETTLEMENT_SETTINGS_MISSING'; end if;
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
    -- 仅「已完成」不可重算；其余状态均允许覆盖（重新结算会重置为待审核）。
    if not v_inserted and v_status = 'completed'::public.salary_record_status then
      raise exception 'SALARY_RECORD_COMPLETED' using errcode = '22023';
    end if;

    v_adjustments := coalesce(nullif(m->'adjustments', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(v_adjustments) <> 'array' then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_adjustments) a
      where nullif(trim(a->>'name'), '') is null
         or jsonb_typeof(a->'amountCents') is distinct from 'number'
         or trunc((a->>'amountCents')::numeric) <> (a->>'amountCents')::numeric
    ) then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;
    select coalesce(sum((a->>'amountCents')::bigint), 0) into v_adj_total
      from jsonb_array_elements(v_adjustments) a;

    v_att_bps := public._payroll_bps_arg(m, 'attendanceBonusBps');
    v_dy_bps := public._payroll_bps_arg(m, 'dyTaskBonusBps');
    v_note := left(coalesce(m->>'note', ''), 500);

    v_scheme := public._anchor_effective_scheme(v_profile_id, v_position_id, p_period_end);
    if v_scheme.id is null then
      raise exception 'SALARY_SCHEME_MISSING' using errcode = 'P0002';
    end if;
    select hire_date, anchor_base_commission_bps into v_hire_date, v_base_commission_bps
      from public.profiles where id = v_profile_id;
    if v_hire_date is null then
      raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_tenure := public._anchor_tenure_month(v_hire_date, p_period_end);
    v_revenue := public._anchor_period_revenue(v_profile_id, p_period_start, p_period_end);
    v_broadcast := public._anchor_period_broadcast_minutes(v_profile_id, p_period_start, p_period_end);

    -- 服务率取自生效方案（手动配置），服务费 = ceil(含调整项的总工资 × 服务率)。
    d := public._anchor_compute_payroll(
      v_scheme.base_salary_cents, v_scheme.guaranteed_salary_cents,
      v_scheme.threshold_multiplier_bps, v_revenue, v_tenure,
      v_base_commission_bps, v_att_bps, v_dy_bps, v_adj_total,
      v_scheme.service_fee_rate_bps);

    if v_inserted then
      insert into public.salary_records (
        profile_id, position_id, scheme_id, month, team_id, period_start, period_end,
        revenue_cents, tenure_month, base_guarantee_cents, threshold_cents,
        commission_start_cents, commission_rate_bps, is_qualified, is_grace_period,
        guaranteed_component_cents, performance_component_cents, gross_cents,
        service_fee_cents, service_fee_rate_bps, net_cents, adjustments, status, review_pending_at,
        attendance_bonus_bps, dy_task_bonus_bps, base_commission_rate_bps, broadcast_minutes,
        note
      ) values (
        v_profile_id, v_position_id, v_scheme.id,
        date_trunc('month', p_period_start)::date, null, p_period_start, p_period_end,
        v_revenue, v_tenure, d.base_guarantee_cents, d.threshold_cents,
        d.commission_start_cents, d.commission_rate_bps, d.is_qualified, d.is_grace_period,
        d.guaranteed_component_cents, d.performance_component_cents, d.gross_cents,
        d.service_fee_cents, v_scheme.service_fee_rate_bps, d.net_cents,
        v_adjustments, 'pending_review'::public.salary_record_status, v_now,
        v_att_bps, v_dy_bps, v_base_commission_bps, v_broadcast,
        v_note
      ) returning id into v_record_id;
    else
      update public.salary_records set
        team_id = null, scheme_id = v_scheme.id,
        revenue_cents = v_revenue, tenure_month = v_tenure,
        base_guarantee_cents = d.base_guarantee_cents, threshold_cents = d.threshold_cents,
        commission_start_cents = d.commission_start_cents, commission_rate_bps = d.commission_rate_bps,
        attendance_bonus_bps = v_att_bps, dy_task_bonus_bps = v_dy_bps,
        base_commission_rate_bps = v_base_commission_bps,
        is_qualified = d.is_qualified, is_grace_period = d.is_grace_period,
        guaranteed_component_cents = d.guaranteed_component_cents,
        performance_component_cents = d.performance_component_cents,
        gross_cents = d.gross_cents, service_fee_cents = d.service_fee_cents,
        service_fee_rate_bps = v_scheme.service_fee_rate_bps, net_cents = d.net_cents,
        adjustments = v_adjustments,
        broadcast_minutes = v_broadcast,
        note = v_note,
        status = 'pending_review'::public.salary_record_status,
        review_pending_at = v_now,
        confirm_pending_at = null,
        confirmed_at = null,
        completed_at = null,
        reviewed_by = null,
        confirmed_by = null,
        completed_by = null,
        updated_at = v_now
      where id = v_record_id;
    end if;
    insert into public.salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else v_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when v_inserted then '管理员手动结算生成（数据库权威重算）'
           else '管理员手动重新结算（数据库权威重算，含调整项）' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.recompute_salary_record(
  p_id uuid, p_attendance_bonus_bps jsonb default null,
  p_dy_task_bonus_bps jsonb default null, p_adjustments jsonb default null,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.salary_records%rowtype;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_adjustments jsonb;
  v_adj_total bigint;
  v_att_bps integer;
  v_dy_bps integer;
  v_scheme public.salary_schemes%rowtype;
  v_hire_date date;
  v_base_commission_bps integer;
  v_tenure integer;
  v_revenue bigint;
  v_broadcast integer;
  d public.anchor_payroll_detail;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;

  select * into rec from public.salary_records where id = p_id for update;
  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if rec.status <> 'pending_review'::public.salary_record_status then
    raise exception 'INVALID_TRANSITION:%->pending_review', rec.status using errcode = '22023';
  end if;

  -- 校验并合计调整项：未传时沿用记录原有调整项。
  v_adjustments := coalesce(nullif(p_adjustments, 'null'::jsonb), rec.adjustments, '[]'::jsonb);
  if jsonb_typeof(v_adjustments) <> 'array' then
    raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_adjustments) a
    where nullif(trim(a->>'name'), '') is null
       or jsonb_typeof(a->'amountCents') is distinct from 'number'
       or trunc((a->>'amountCents')::numeric) <> (a->>'amountCents')::numeric
  ) then
    raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
  end if;
  select coalesce(sum((a->>'amountCents')::bigint), 0) into v_adj_total
    from jsonb_array_elements(v_adjustments) a;

  -- 加点：未传时沿用记录原值（打包成 jsonb 复用校验口径）。
  v_att_bps := public._payroll_bps_arg(
    jsonb_build_object('v', coalesce(p_attendance_bonus_bps, to_jsonb(rec.attendance_bonus_bps))), 'v');
  v_dy_bps := public._payroll_bps_arg(
    jsonb_build_object('v', coalesce(p_dy_task_bonus_bps, to_jsonb(rec.dy_task_bonus_bps))), 'v');

  -- 解析方案 / 入职日 / 基础提成率 / 任职月 / 周期流水。
  v_scheme := public._anchor_effective_scheme(rec.profile_id, rec.position_id, rec.period_end);
  if v_scheme.id is null then
    raise exception 'SALARY_SCHEME_MISSING' using errcode = 'P0002';
  end if;
  select hire_date, anchor_base_commission_bps into v_hire_date, v_base_commission_bps
    from public.profiles where id = rec.profile_id;
  if v_hire_date is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_tenure := public._anchor_tenure_month(v_hire_date, rec.period_end);
  v_revenue := public._anchor_period_revenue(rec.profile_id, rec.period_start, rec.period_end);
  v_broadcast := public._anchor_period_broadcast_minutes(rec.profile_id, rec.period_start, rec.period_end);

  d := public._anchor_compute_payroll(
    v_scheme.base_salary_cents, v_scheme.guaranteed_salary_cents,
    v_scheme.threshold_multiplier_bps, v_revenue, v_tenure,
    v_base_commission_bps, v_att_bps, v_dy_bps, v_adj_total,
    v_scheme.service_fee_rate_bps);

  update public.salary_records
  set scheme_id = v_scheme.id,
      revenue_cents = v_revenue,
      tenure_month = v_tenure,
      base_guarantee_cents = d.base_guarantee_cents,
      threshold_cents = d.threshold_cents,
      commission_start_cents = d.commission_start_cents,
      commission_rate_bps = d.commission_rate_bps,
      base_commission_rate_bps = v_base_commission_bps,
      attendance_bonus_bps = v_att_bps,
      dy_task_bonus_bps = v_dy_bps,
      is_qualified = d.is_qualified,
      is_grace_period = d.is_grace_period,
      guaranteed_component_cents = d.guaranteed_component_cents,
      performance_component_cents = d.performance_component_cents,
      gross_cents = d.gross_cents,
      service_fee_cents = d.service_fee_cents,
      service_fee_rate_bps = v_scheme.service_fee_rate_bps,
      net_cents = d.net_cents,
      adjustments = v_adjustments,
      broadcast_minutes = v_broadcast,
      status = 'pending_review'::public.salary_record_status,
      review_pending_at = v_now,
      updated_at = v_now
  where id = p_id;

  insert into public.salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review'::public.salary_record_status,
          'pending_review'::public.salary_record_status, v_operator,
          coalesce(p_note, '管理员驳回，已按当前流水由数据库权威重算'));
end $$;

revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb) to authenticated;

revoke all on function public.recompute_salary_record(uuid, jsonb, jsonb, jsonb, text)
  from public, anon, service_role;
grant execute on function public.recompute_salary_record(uuid, jsonb, jsonb, jsonb, text)
  to authenticated;

commit;
