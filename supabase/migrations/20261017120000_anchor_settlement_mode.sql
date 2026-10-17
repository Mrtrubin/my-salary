-- 主播工资结算方式：保底结算（guarantee，现有「保底/提成互斥」口径）与
-- 固定百分比（fixed_percent，总工资 = floor(总流水 × 固定百分比)）二选一，按方案配置。
--
-- 1) salary_schemes 增加 settlement_mode（默认 guarantee）与 fixed_percent_bps（默认 2000 bps = 20%）；
-- 2) salary_records 增加 settlement_mode 快照列（固定百分比复用 commission_rate_bps 快照）；
-- 3) _anchor_compute_payroll 增加固定百分比分支：忽略保底门槛/阶梯提成/考勤/dy 加点；
--    调整项照常叠加，服务费照扣（= ceil((总工资 + 调整项合计) × 服务率)）；
--    初始保底两种方式都保留配置（固定百分比下用于停播/延误调整项预设）；
-- 4) settle_anchor_revenue / recompute_salary_record 读取方案新字段并快照 settlement_mode。
begin;

alter table public.salary_schemes
  add column if not exists settlement_mode text not null default 'guarantee'
    check (settlement_mode in ('guarantee', 'fixed_percent')),
  add column if not exists fixed_percent_bps integer not null default 2000
    check (fixed_percent_bps between 1 and 10000);

alter table public.salary_records
  add column if not exists settlement_mode text not null default 'guarantee'
    check (settlement_mode in ('guarantee', 'fixed_percent'));

-- ---------- 计算核心：在既有口径上追加固定百分比分支 ----------
-- 先删除旧 10 参重载：新版追加 2 个带默认值参数后，10 参调用会命中两个签名产生歧义
-- （function ... is not unique）。仅有的调用方 settle_anchor_revenue / recompute_salary_record
-- 已改为 12 参调用。
drop function if exists public._anchor_compute_payroll(
  bigint, bigint, integer, bigint, integer, integer, integer, integer, bigint, integer);

create or replace function public._anchor_compute_payroll(
  p_base_salary_cents bigint,
  p_guaranteed_salary_cents bigint,
  p_threshold_multiplier_bps integer,
  p_monthly_revenue_cents bigint,
  p_tenure_month integer,
  p_base_commission_rate_bps integer,
  p_attendance_bonus_bps integer,
  p_dy_task_bonus_bps integer,
  p_adjustment_total_cents bigint,
  p_service_fee_rate_bps integer default 300,
  p_settlement_mode text default 'guarantee',
  p_fixed_percent_bps integer default 2000
)
returns public.anchor_payroll_detail language plpgsql immutable set search_path = '' as $$
declare
  r public.anchor_payroll_detail;
  v_steps integer;
  v_capped_steps integer;
  v_gross_before bigint;
begin
  -- 基本合法性校验（对齐 anchor.ts validateInput）。
  if p_attendance_bonus_bps < 0 or p_attendance_bonus_bps > 2147483647
     or p_dy_task_bonus_bps < 0 or p_dy_task_bonus_bps > 2147483647 then
    raise exception 'INVALID_COMMISSION_BPS:bonus' using errcode = '22023';
  end if;
  if p_base_commission_rate_bps is null or p_base_commission_rate_bps <= 0
     or p_base_commission_rate_bps > 10000 then
    raise exception 'INVALID_COMMISSION_BPS:baseCommissionRateBps' using errcode = '22023';
  end if;
  if p_tenure_month < 1 then
    raise exception 'INVALID_SETTLEMENT_TENURE' using errcode = '22023';
  end if;

  -- 固定百分比模式：总工资 = floor(总流水 × 固定百分比)；忽略保底门槛/阶梯/加点，
  -- 调整项照常叠加，服务费照扣。初始保底快照保留（用于停播/延误等调整项预设展示）。
  if coalesce(p_settlement_mode, 'guarantee') = 'fixed_percent' then
    if p_fixed_percent_bps is null or p_fixed_percent_bps < 1 or p_fixed_percent_bps > 10000 then
      raise exception 'INVALID_FIXED_PERCENT_BPS' using errcode = '22023';
    end if;
    r.is_grace_period := p_tenure_month between 1 and 3;
    r.threshold_cents := 0;
    r.commission_start_cents := 0;
    r.is_qualified := true;
    r.base_guarantee_cents := p_base_salary_cents;
    r.commission_rate_bps := p_fixed_percent_bps;
    r.performance_component_cents := public._payroll_rate_floor(
      p_monthly_revenue_cents, p_fixed_percent_bps);
    r.guaranteed_component_cents := 0;
    r.gross_cents := r.guaranteed_component_cents + r.performance_component_cents
      + p_adjustment_total_cents;
    r.service_fee_cents := public._payroll_rate_ceil(r.gross_cents, p_service_fee_rate_bps);
    r.net_cents := r.gross_cents - r.service_fee_cents;
    return r;
  end if;

  -- 保底模式（既有口径，与 lib/domain/payroll/anchor.ts 完全一致）。
  -- 门槛固定用初始保底 × 系数，向上取整到分。
  r.threshold_cents := public._payroll_rate_ceil(p_base_salary_cents, p_threshold_multiplier_bps);
  -- 达标按当月流水。
  r.is_qualified := p_monthly_revenue_cents >= r.threshold_cents;
  -- 无责期：前 3 个月。
  r.is_grace_period := p_tenure_month between 1 and 3;
  -- 保底基准：无责期一律初始保底（保底保护）；非无责期按当月达标，达标初始、不达标降级。
  r.base_guarantee_cents := case when r.is_grace_period or r.is_qualified
    then p_base_salary_cents else p_guaranteed_salary_cents end;
  -- 起征 = 初始保底 × 5。
  r.commission_start_cents := p_base_salary_cents * 5;

  -- 阶梯提成：仅当流水 >= 起征才计提。
  if p_monthly_revenue_cents >= r.commission_start_cents then
    v_steps := greatest(0,
      floor((p_monthly_revenue_cents - r.commission_start_cents) / 1000000)::integer);
    v_capped_steps := least(v_steps, 5);
    -- 最终费率 = 基础 + 阶梯加点 + 考勤 + dy，用 numeric 防溢出再校验。
    if (p_base_commission_rate_bps::numeric + v_capped_steps * 100
        + p_attendance_bonus_bps + p_dy_task_bonus_bps) > 2147483647 then
      raise exception 'COMMISSION_RATE_OVERFLOW' using errcode = '22003';
    end if;
    r.commission_rate_bps := p_base_commission_rate_bps + v_capped_steps * 100
      + p_attendance_bonus_bps + p_dy_task_bonus_bps;
  else
    r.commission_rate_bps := 0;
  end if;

  -- 提成互斥：费率>0 走提成模式，否则走保底模式。
  if r.commission_rate_bps > 0 then
    r.performance_component_cents := public._payroll_rate_floor(
      p_monthly_revenue_cents, r.commission_rate_bps);
    r.guaranteed_component_cents := 0;
  else
    r.performance_component_cents := 0;
    r.guaranteed_component_cents := r.base_guarantee_cents;
  end if;

  -- 调整项叠加在总工资之上，服务费按含调整项的总工资重算。
  v_gross_before := r.guaranteed_component_cents + r.performance_component_cents;
  r.gross_cents := v_gross_before + p_adjustment_total_cents;
  r.service_fee_cents := public._payroll_rate_ceil(r.gross_cents, p_service_fee_rate_bps);
  r.net_cents := r.gross_cents - r.service_fee_cents;
  return r;
end $$;

-- ---------- 结算：读取方案新字段，传给计算核心并快照 settlement_mode ----------
create or replace function public.settle_anchor_revenue(p_team_id uuid, p_period_start date, p_period_end date, p_members jsonb, p_replace_overlapping boolean default false)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m jsonb;
  v_profile_id uuid;
  v_role_id bigint;
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
       or nullif(x->>'profileId', '') is null or nullif(x->>'roleId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_MEMBER' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) x
    group by (x->>'profileId')::uuid, (x->>'roleId')::bigint having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_MEMBER_ROLE' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_members)
  loop
    v_profile_id := (m->>'profileId')::uuid;
    v_role_id := (m->>'roleId')::bigint;

    -- 覆盖模式：先处理与之重叠的其它区间记录（不含本次精确区间）。
    if p_replace_overlapping then
      if exists (
        select 1 from public.salary_records r
        where r.profile_id = v_profile_id and r.role_id = v_role_id
          and r.period_start <= p_period_end and p_period_start <= r.period_end
          and not (r.period_start = p_period_start and r.period_end = p_period_end)
          and r.status = 'completed'::public.salary_record_status
      ) then
        raise exception 'SALARY_OVERLAP_COMPLETED' using errcode = '22023';
      end if;
      delete from public.salary_records r
      where r.profile_id = v_profile_id and r.role_id = v_role_id
        and r.period_start <= p_period_end and p_period_start <= r.period_end
        and not (r.period_start = p_period_start and r.period_end = p_period_end);
    end if;

    select id, status into v_record_id, v_status from public.salary_records
    where profile_id = v_profile_id and role_id = v_role_id
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

    v_scheme := public._anchor_effective_scheme(v_profile_id, v_role_id, p_period_end);
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

    -- 服务率取自生效方案（手动配置）；结算方式与固定百分比同取自方案。
    d := public._anchor_compute_payroll(
      v_scheme.base_salary_cents, v_scheme.guaranteed_salary_cents,
      v_scheme.threshold_multiplier_bps, v_revenue, v_tenure,
      v_base_commission_bps, v_att_bps, v_dy_bps, v_adj_total,
      v_scheme.service_fee_rate_bps,
      v_scheme.settlement_mode, v_scheme.fixed_percent_bps);

    if v_inserted then
      insert into public.salary_records (
        profile_id, role_id, scheme_id, month, team_id, period_start, period_end,
        revenue_cents, tenure_month, base_guarantee_cents, threshold_cents,
        commission_start_cents, commission_rate_bps, is_qualified, is_grace_period,
        guaranteed_component_cents, performance_component_cents, gross_cents,
        service_fee_cents, service_fee_rate_bps, net_cents, adjustments, status, review_pending_at,
        attendance_bonus_bps, dy_task_bonus_bps, base_commission_rate_bps, broadcast_minutes,
        note, settlement_mode
      ) values (
        v_profile_id, v_role_id, v_scheme.id,
        date_trunc('month', p_period_start)::date, null, p_period_start, p_period_end,
        v_revenue, v_tenure, d.base_guarantee_cents, d.threshold_cents,
        d.commission_start_cents, d.commission_rate_bps, d.is_qualified, d.is_grace_period,
        d.guaranteed_component_cents, d.performance_component_cents, d.gross_cents,
        d.service_fee_cents, v_scheme.service_fee_rate_bps, d.net_cents,
        v_adjustments, 'pending_review'::public.salary_record_status, v_now,
        v_att_bps, v_dy_bps, v_base_commission_bps, v_broadcast,
        v_note, v_scheme.settlement_mode
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
        settlement_mode = v_scheme.settlement_mode,
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
end $function$;

-- ---------- 驳回重算：读取方案新字段，传给计算核心并刷新 settlement_mode 快照 ----------
create or replace function public.recompute_salary_record(p_id uuid, p_attendance_bonus_bps jsonb default null::jsonb, p_dy_task_bonus_bps jsonb default null::jsonb, p_adjustments jsonb default null::jsonb, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  v_scheme := public._anchor_effective_scheme(rec.profile_id, rec.role_id, rec.period_end);
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
    v_scheme.service_fee_rate_bps,
    v_scheme.settlement_mode, v_scheme.fixed_percent_bps);

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
      settlement_mode = v_scheme.settlement_mode,
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
end $function$;

-- ---------- 7. 刷新 PostgREST schema 缓存 ----------
notify pgrst, 'reload schema';

commit;
