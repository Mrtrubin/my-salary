-- 重叠区间结算：允许覆盖未完成的重叠工资记录，已完成记录仍拒绝。
--
-- 结算 RPC 新增 p_replace_overlapping：
--   true  → 先删除同人同岗位与之重叠的非 completed 记录（状态日志级联删除），再写入；
--           若重叠记录中存在 completed，则抛 SALARY_OVERLAP_COMPLETED / HOST_SALARY_OVERLAP_COMPLETED。
--   false → 保持原防重叠：存在重叠时由守卫触发器抛 *_PERIOD_OVERLAP。
-- 前端在用户二级确认后传 true；同一精确区间的记录仍走“更新”而非删除。
begin;

-- ---------- 1. 主播结算 RPC：支持覆盖重叠未完成记录 ----------
drop function if exists public.settle_anchor_revenue(uuid, date, date, jsonb);

create or replace function public.settle_anchor_revenue(
  p_team_id uuid, p_period_start date, p_period_end date, p_members jsonb,
  p_replace_overlapping boolean default false
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
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

  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end)
     or p_period_end < p_period_start then
    raise exception 'INVALID_SETTLEMENT_PERIOD' using errcode = '22023';
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

    -- 覆盖模式：先处理与之重叠的其它区间记录（不含本次精确区间）。
    if p_replace_overlapping then
      if exists (
        select 1 from public.salary_records r
        where r.profile_id = v_profile_id and r.position_id = v_position_id
          and r.period_start <= p_period_end and p_period_start <= r.period_end
          and not (r.period_start = p_period_start and r.period_end = p_period_end)
          and r.status = 'completed'::public.salary_record_status
      ) then
        raise exception 'SALARY_OVERLAP_COMPLETED' using errcode = '22023';
      end if;
      delete from public.salary_records r
      where r.profile_id = v_profile_id and r.position_id = v_position_id
        and r.period_start <= p_period_end and p_period_start <= r.period_end
        and not (r.period_start = p_period_start and r.period_end = p_period_end);
    end if;

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

revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb, boolean) to authenticated;

-- ---------- 2. 主持工资：新增防重叠守卫 + RPC 支持覆盖重叠未完成记录 ----------
create or replace function public.guard_host_salary_period_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.period_start is null or new.period_end is null
     or new.period_start > new.period_end then
    raise exception 'INVALID_SALARY_PERIOD' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.host_salary_records r
    where r.host_profile_id = new.host_profile_id
      and (tg_op = 'INSERT' or r.id <> old.id)
      and r.period_start <= new.period_end and new.period_start <= r.period_end
  ) then
    raise exception 'HOST_SALARY_PERIOD_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists host_salary_records_period_overlap_guard on public.host_salary_records;
create trigger host_salary_records_period_overlap_guard
  before insert or update on public.host_salary_records
  for each row execute function public.guard_host_salary_period_overlap();

drop function if exists public.settle_host_payroll(date, date, jsonb);

create or replace function public.settle_host_payroll(
  p_period_start date, p_period_end date, p_hosts jsonb,
  p_replace_overlapping boolean default false
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  v_host_id uuid;
  v_record_id uuid;
  v_status public.salary_record_status;
  v_inserted boolean;
  v_count integer := 0;
  v_operator uuid;
  v_now timestamptz := now();
  v_adjustments jsonb;
  v_adj_total bigint;
  v_scheme public.host_salary_schemes%rowtype;
  v_revenue bigint;
  v_broadcast integer;
  v_breakdown jsonb;
  d public.host_payroll_detail;
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  v_operator := public.current_profile_id();

  if p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end)
     or p_period_end < p_period_start then
    raise exception 'INVALID_SETTLEMENT_PERIOD' using errcode = '22023';
  end if;
  if jsonb_typeof(p_hosts) is distinct from 'array' then
    raise exception 'INVALID_SETTLEMENT_HOSTS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_hosts) x
    where jsonb_typeof(x) <> 'object' or nullif(x->>'hostProfileId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_HOST' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_hosts) x
    group by (x->>'hostProfileId')::uuid having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_HOST' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_hosts)
  loop
    v_host_id := (m->>'hostProfileId')::uuid;

    -- 覆盖模式：先处理与之重叠的其它区间记录（不含本次精确区间）。
    if p_replace_overlapping then
      if exists (
        select 1 from public.host_salary_records r
        where r.host_profile_id = v_host_id
          and r.period_start <= p_period_end and p_period_start <= r.period_end
          and not (r.period_start = p_period_start and r.period_end = p_period_end)
          and r.status = 'completed'::public.salary_record_status
      ) then
        raise exception 'HOST_SALARY_OVERLAP_COMPLETED' using errcode = '22023';
      end if;
      delete from public.host_salary_records r
      where r.host_profile_id = v_host_id
        and r.period_start <= p_period_end and p_period_start <= r.period_end
        and not (r.period_start = p_period_start and r.period_end = p_period_end);
    end if;

    select id, status into v_record_id, v_status from public.host_salary_records
    where host_profile_id = v_host_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'HOST_SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
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

    v_scheme := public._host_effective_scheme(v_host_id, p_period_end);
    if v_scheme.id is null then
      raise exception 'HOST_SALARY_SCHEME_MISSING' using errcode = 'P0002';
    end if;

    v_revenue := public._host_period_revenue(v_host_id, p_period_start, p_period_end);
    v_broadcast := public._host_period_broadcast_minutes(v_host_id, p_period_start, p_period_end);
    v_breakdown := public._host_period_team_breakdown(v_host_id, p_period_start, p_period_end);

    d := public._host_compute_payroll(
      v_scheme.base_income_cents, v_scheme.commission_start_cents,
      v_scheme.base_commission_rate_bps, v_scheme.service_fee_rate_bps,
      v_revenue, v_adj_total);

    if v_inserted then
      insert into public.host_salary_records (
        host_profile_id, scheme_id, month, period_start, period_end,
        revenue_cents, broadcast_minutes, team_breakdown, threshold_cents, is_qualified,
        base_commission_rate_bps, tier_bonus_bps, commission_rate_bps, base_income_cents,
        adjustments, gross_cents, service_fee_rate_bps, service_fee_cents, net_cents,
        status, review_pending_at
      ) values (
        v_host_id, v_scheme.id, date_trunc('month', p_period_start)::date, p_period_start, p_period_end,
        v_revenue, v_broadcast, v_breakdown, d.threshold_cents, d.is_qualified,
        v_scheme.base_commission_rate_bps, d.tier_bonus_bps, d.commission_rate_bps, d.base_income_cents,
        v_adjustments, d.gross_cents, v_scheme.service_fee_rate_bps, d.service_fee_cents, d.net_cents,
        'pending_review'::public.salary_record_status, v_now
      ) returning id into v_record_id;
    else
      update public.host_salary_records set
        scheme_id = v_scheme.id,
        revenue_cents = v_revenue,
        broadcast_minutes = v_broadcast,
        team_breakdown = v_breakdown,
        threshold_cents = d.threshold_cents,
        is_qualified = d.is_qualified,
        base_commission_rate_bps = v_scheme.base_commission_rate_bps,
        tier_bonus_bps = d.tier_bonus_bps,
        commission_rate_bps = d.commission_rate_bps,
        base_income_cents = d.base_income_cents,
        adjustments = v_adjustments,
        gross_cents = d.gross_cents,
        service_fee_rate_bps = v_scheme.service_fee_rate_bps,
        service_fee_cents = d.service_fee_cents,
        net_cents = d.net_cents,
        status = 'pending_review'::public.salary_record_status,
        review_pending_at = v_now, updated_at = v_now
      where id = v_record_id;
    end if;

    insert into public.host_salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when v_inserted then '管理员手动结算生成（数据库权威重算）'
           else '管理员手动重新结算（数据库权威重算，含调整项）' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.settle_host_payroll(date, date, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_host_payroll(date, date, jsonb, boolean) to authenticated;

revoke all on function public.guard_host_salary_period_overlap()
  from public, anon, authenticated, service_role;

commit;
