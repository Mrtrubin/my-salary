-- 方案B：数据库成为工资计算的单一权威（防篡改）。
-- 背景：此前 settle_anchor_revenue / recompute_salary_record 只透传前端算好的金额，
--   前端 anchor.ts 一旦被篡改即可写入任意工资。现改为：前端仅传【身份 + 加点 + 调整项】，
--   数据库自行读取 salary_schemes / anchor_revenue_records / profiles，完整重算并落库。
--   前端 anchor.ts 降级为纯预览展示，不再参与落库。
--
-- 计算口径（与 lib/domain/payroll/anchor.ts「保底/提成互斥模式」完全一致）：
--   门槛 = ceil(初始保底 × thresholdMultiplierBps / 10000)（固定用初始保底）。
--   达标 = 当月流水 >= 门槛。
--   保底基准 = 达标 ? 初始保底 : 降级保底。
--   起征（拿提点门槛）= 初始保底 × 5。
--   阶梯提成 = 20% 起步，超过起征每满 1 万元 +1%，阶梯加点封顶 5 点；再叠加考勤/dy 加点，总费率不封顶。
--   提成互斥：流水 >= 起征 → 总工资 = floor(流水 × 最终费率)（不叠加保底）；否则 = 保底工资全额。
--   服务费 = ceil(总工资 × 300 / 10000)。
--   调整项：总工资 += 调整项合计（可正可负），服务费按含调整项的总工资重算，实发 = 总工资 − 服务费。
--   溢出校验：最终提成费率不得超过 PostgreSQL integer 上限 2147483647。
begin;

-- ---------- 1. 整数取整工具（与前端 money.ts 的 Math.ceil / Math.floor 语义一致） ----------
-- 用 numeric 计算后 ceil/floor 到分，负数金额同样按数学取整方向。
create or replace function public._payroll_rate_ceil(p_amount bigint, p_bps bigint)
returns bigint language sql immutable set search_path = '' as $$
  select ceil((p_amount::numeric * p_bps) / 10000)::bigint;
$$;

create or replace function public._payroll_rate_floor(p_amount bigint, p_bps bigint)
returns bigint language sql immutable set search_path = '' as $$
  select floor((p_amount::numeric * p_bps) / 10000)::bigint;
$$;

-- ---------- 2. 核心算法：给定已解析输入，产出工资明细（不触库、纯计算） ----------
-- 返回复合类型，字段名对应 salary_records 列，供上层直接落库。
do $$ begin
  if not exists (select 1 from pg_type where typname = 'anchor_payroll_detail') then
    create type public.anchor_payroll_detail as (
      threshold_cents bigint,
      is_qualified boolean,
      is_grace_period boolean,
      base_guarantee_cents bigint,
      commission_start_cents bigint,
      commission_rate_bps integer,
      guaranteed_component_cents bigint,
      performance_component_cents bigint,
      gross_cents bigint,
      service_fee_cents bigint,
      net_cents bigint
    );
  end if;
end $$;

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
  p_service_fee_rate_bps integer default 300
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

  -- 门槛固定用初始保底 × 系数，向上取整到分。
  r.threshold_cents := public._payroll_rate_ceil(p_base_salary_cents, p_threshold_multiplier_bps);
  -- 达标按当月流水。
  r.is_qualified := p_monthly_revenue_cents >= r.threshold_cents;
  -- 无责期：前 3 个月。
  r.is_grace_period := p_tenure_month between 1 and 3;
  -- 保底基准：达标取初始保底，否则降级保底。
  r.base_guarantee_cents := case when r.is_qualified
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

-- ---------- 3. 解析器：任职月 / 周期流水 / 生效方案（读库，供 RPC 复用） ----------
-- 任职月序：入职月到周期止月的月差 + 1，周期止日早于入职返回 1（对齐 calcTenureMonth）。
create or replace function public._anchor_tenure_month(p_hire_date date, p_period_end date)
returns integer language sql stable set search_path = '' as $$
  select greatest(1,
    ((extract(year from p_period_end) - extract(year from p_hire_date)) * 12
     + (extract(month from p_period_end) - extract(month from p_hire_date)))::integer + 1);
$$;

-- 周期内跨团流水求和：no_perf=false 的 revenue_cents 累加（对齐前端 readProfileRevenue + aggregate）。
create or replace function public._anchor_period_revenue(
  p_profile_id uuid, p_period_start date, p_period_end date
)
returns bigint language sql stable set search_path = '' as $$
  select coalesce(sum(revenue_cents), 0)::bigint
  from public.anchor_revenue_records
  where profile_id = p_profile_id
    and no_perf = false
    and perf_date between p_period_start and p_period_end;
$$;

-- 生效方案选取：个人方案优先，其次同岗位模板；status=active 且 effective_from<=period_end，
-- 取 effective_from、version 最新（对齐 loadSettlementContexts）。
create or replace function public._anchor_effective_scheme(
  p_profile_id uuid, p_position_id bigint, p_period_end date
)
returns public.salary_schemes language sql stable set search_path = '' as $$
  select * from public.salary_schemes
  where position_id = p_position_id
    and status = 'active'
    and effective_from <= p_period_end
    and (profile_id = p_profile_id or profile_id is null)
  order by (profile_id is not null) desc, effective_from desc, version desc, id
  limit 1;
$$;

-- 解析并校验单个加点参数：缺省为 0，须为 [0, int max] 内整数（对齐前端校验，避免小数/溢出）。
create or replace function public._payroll_bps_arg(p_member jsonb, p_key text)
returns integer language plpgsql immutable set search_path = '' as $$
declare v_bps numeric;
begin
  if not (p_member ? p_key) or jsonb_typeof(p_member->p_key) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(p_member->p_key) is distinct from 'number' then
    raise exception 'INVALID_COMMISSION_BPS:%', p_key using errcode = '22023';
  end if;
  v_bps := (p_member->>p_key)::numeric;
  if v_bps < 0 or v_bps > 2147483647 or trunc(v_bps) <> v_bps then
    raise exception 'INVALID_COMMISSION_BPS:%', p_key using errcode = '22023';
  end if;
  return v_bps::integer;
end $$;

-- ---------- 4. 重写 settle_anchor_revenue：SQL 内完整重算落库（前端仅传身份/加点/调整项） ----------
-- p_members 每项仅需：profileId、positionId、attendanceBonusBps?、dyTaskBonusBps?、adjustments?
-- 所有金额字段（gross/serviceFee/net/门槛/保底/起征/费率/流水/任职月）一律由数据库计算，忽略前端传入。
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

    -- 已有精确周期走 UPDATE，且仅允许 pending_review 覆盖。
    select id, status into v_record_id, v_status from public.salary_records
    where profile_id = v_profile_id and position_id = v_position_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
    end if;

    -- 校验并合计调整项（对齐 sumAdjustments）。
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

    -- 加点：缺省为 0，须为 [0, int max] 内整数（对齐前端校验）。
    v_att_bps := public._payroll_bps_arg(m, 'attendanceBonusBps');
    v_dy_bps := public._payroll_bps_arg(m, 'dyTaskBonusBps');

    -- 解析方案 / 入职日 / 基础提成率 / 任职月 / 周期流水，全部由数据库读取。
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

    d := public._anchor_compute_payroll(
      v_scheme.base_salary_cents, v_scheme.guaranteed_salary_cents,
      v_scheme.threshold_multiplier_bps, v_revenue, v_tenure,
      v_base_commission_bps, v_att_bps, v_dy_bps, v_adj_total, 300);

    if v_inserted then
      insert into public.salary_records (
        profile_id, position_id, scheme_id, month, team_id, period_start, period_end,
        revenue_cents, tenure_month, base_guarantee_cents, threshold_cents,
        commission_start_cents, commission_rate_bps, is_qualified, is_grace_period,
        guaranteed_component_cents, performance_component_cents, gross_cents,
        service_fee_cents, net_cents, adjustments, status, review_pending_at,
        attendance_bonus_bps, dy_task_bonus_bps, base_commission_rate_bps
      ) values (
        v_profile_id, v_position_id, v_scheme.id,
        date_trunc('month', p_period_start)::date, null, p_period_start, p_period_end,
        v_revenue, v_tenure, d.base_guarantee_cents, d.threshold_cents,
        d.commission_start_cents, d.commission_rate_bps, d.is_qualified, d.is_grace_period,
        d.guaranteed_component_cents, d.performance_component_cents, d.gross_cents,
        d.service_fee_cents, d.net_cents,
        v_adjustments, 'pending_review'::public.salary_record_status, v_now,
        v_att_bps, v_dy_bps, v_base_commission_bps
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
        gross_cents = d.gross_cents, service_fee_cents = d.service_fee_cents, net_cents = d.net_cents,
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
      case when v_inserted then '管理员手动结算生成（数据库权威重算）'
           else '管理员手动重新结算（数据库权威重算，含调整项）' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb) to authenticated;

-- ---------- 5. 重写 recompute_salary_record：仅传身份/加点/调整项，SQL 内重算落库 ----------
-- 旧签名接收 16 个已算金额，方案 B 下改为读记录本身的 profile/position/period 后完整重算。
drop function if exists public.recompute_salary_record(
  uuid, bigint, integer, bigint, bigint, bigint, integer, boolean, boolean,
  bigint, bigint, bigint, bigint, bigint, integer, text
);

create function public.recompute_salary_record(
  p_id uuid,
  p_attendance_bonus_bps jsonb default null,
  p_dy_task_bonus_bps jsonb default null,
  p_adjustments jsonb default null,
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

  d := public._anchor_compute_payroll(
    v_scheme.base_salary_cents, v_scheme.guaranteed_salary_cents,
    v_scheme.threshold_multiplier_bps, v_revenue, v_tenure,
    v_base_commission_bps, v_att_bps, v_dy_bps, v_adj_total, 300);

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
      net_cents = d.net_cents,
      adjustments = v_adjustments,
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

revoke all on function public.recompute_salary_record(uuid, jsonb, jsonb, jsonb, text)
  from public, anon, service_role;
grant execute on function public.recompute_salary_record(uuid, jsonb, jsonb, jsonb, text)
  to authenticated;

commit;