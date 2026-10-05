-- 将「职位 / position」领域概念全量重命名为「角色 / role」：
--   public.positions      -> public.roles
--   public.user_positions -> public.user_roles
--   *.position_id         -> *.role_id
-- 同时重命名相关约束/索引/策略，并按新列名重建相关函数。

-- ---------- 0. 先删除需要改参数名的函数 ----------
drop function if exists public._anchor_effective_scheme(uuid, bigint, date);
drop function if exists public.set_staff_base_income(uuid, text, bigint);

-- ---------- 1. 重命名表 ----------
alter table public.positions rename to roles;
alter table public.user_positions rename to user_roles;

-- ---------- 2. 重命名列 ----------
alter table public.user_roles rename column position_id to role_id;
alter table public.salary_schemes rename column position_id to role_id;
alter table public.salary_records rename column position_id to role_id;
alter table public.host_salary_schemes rename column position_id to role_id;
alter table public.staff_base_incomes rename column position_id to role_id;
alter table public.staff_salary_records rename column position_id to role_id;

-- ---------- 3. 重命名约束（唯一约束的底层索引随约束一起改名） ----------
alter table public.roles rename constraint positions_pkey to roles_pkey;
alter table public.roles rename constraint positions_code_key to roles_code_key;
alter table public.roles rename constraint positions_code_check to roles_code_check;
alter table public.roles rename constraint positions_name_key to roles_name_key;
alter table public.roles rename constraint positions_name_check to roles_name_check;

alter table public.user_roles rename constraint user_positions_pkey to user_roles_pkey;
alter table public.user_roles rename constraint user_positions_profile_id_fkey to user_roles_profile_id_fkey;
alter table public.user_roles rename constraint user_positions_position_id_fkey to user_roles_role_id_fkey;

alter table public.salary_schemes rename constraint salary_schemes_position_id_fkey to salary_schemes_role_id_fkey;
alter table public.salary_records rename constraint salary_records_position_id_fkey to salary_records_role_id_fkey;
alter table public.host_salary_schemes rename constraint host_salary_schemes_position_id_fkey to host_salary_schemes_role_id_fkey;
alter table public.staff_salary_records rename constraint staff_salary_records_position_id_fkey to staff_salary_records_role_id_fkey;
alter table public.staff_salary_records rename constraint staff_salary_records_profile_id_position_id_period_start_pe_key to staff_salary_records_profile_id_role_id_period_start_pe_key;
alter table public.staff_base_incomes rename constraint staff_base_incomes_position_id_fkey to staff_base_incomes_role_id_fkey;
alter table public.staff_base_incomes rename constraint staff_base_incomes_profile_id_position_id_key to staff_base_incomes_profile_id_role_id_key;

-- ---------- 4. 重命名非约束索引 ----------
alter index public.salary_records_position_id_idx rename to salary_records_role_id_idx;
alter index public.salary_records_person_position_period_key rename to salary_records_person_role_period_key;
alter index public.salary_schemes_position_id_idx rename to salary_schemes_role_id_idx;
alter index public.salary_schemes_profile_position_idx rename to salary_schemes_profile_role_idx;
alter index public.staff_base_incomes_position_idx rename to staff_base_incomes_role_idx;
alter index public.user_positions_position_id_idx rename to user_roles_role_id_idx;

-- ---------- 5. 重命名 RLS 策略 ----------
alter policy positions_select on public.roles rename to roles_select;
alter policy positions_admin_insert on public.roles rename to roles_admin_insert;
alter policy positions_admin_update on public.roles rename to roles_admin_update;

alter policy user_positions_select on public.user_roles rename to user_roles_select;
alter policy user_positions_insert on public.user_roles rename to user_roles_insert;
alter policy user_positions_delete on public.user_roles rename to user_roles_delete;

-- ---------- 6. 重命名身份列序列 ----------
alter sequence if exists public.positions_id_seq rename to roles_id_seq;

-- ---------- 7. 重建函数 ----------

-- 生效方案（参数 p_position_id -> p_role_id）
create function public._anchor_effective_scheme(p_profile_id uuid, p_role_id bigint, p_period_end date)
 returns public.salary_schemes
 language sql
 stable
 set search_path to ''
as $function$
  select * from public.salary_schemes
  where role_id = p_role_id
    and status = 'active'
    and (profile_id = p_profile_id or profile_id is null)
  order by (profile_id is not null) desc, effective_from desc, version desc, id
  limit 1;
$function$;

-- 设置基础薪资（参数 p_position_code -> p_role_code）
create function public.set_staff_base_income(p_profile_id uuid, p_role_code text, p_cents bigint)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role_id bigint;
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_cents is null or p_cents < 0 then
    raise exception 'INVALID_BASE_INCOME' using errcode = '22023';
  end if;
  select id into v_role_id from public.roles where code = p_role_code;
  if v_role_id is null then
    raise exception 'UNSUPPORTED_ROLE:%', p_role_code using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.staff_base_incomes (profile_id, role_id, base_income_cents, updated_at)
  values (p_profile_id, v_role_id, p_cents, now())
  on conflict (profile_id, role_id) do update
    set base_income_cents = excluded.base_income_cents,
        updated_at = now();
end $function$;

revoke execute on function public.set_staff_base_income(uuid, text, bigint) from public, anon, service_role;
grant execute on function public.set_staff_base_income(uuid, text, bigint) to authenticated;

create or replace function public.is_dance()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
    from public.user_roles up
    join public.roles p on p.id = up.role_id
    where up.profile_id = public.current_profile_id() and p.code = 'dance'
  );
$function$;

create or replace function public.is_makeup()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
    from public.user_roles up
    join public.roles p on p.id = up.role_id
    where up.profile_id = public.current_profile_id() and p.code = 'makeup'
  );
$function$;

create or replace function public.list_anchor_members()
 returns table(id uuid, name text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select p.id, p.name
  from public.profiles p
  join public.user_roles up on up.profile_id = p.id
  join public.roles pos on pos.id = up.role_id
  where pos.code = 'anchor'
    and p.status = 'active'
    and (public.is_admin() or public.is_makeup() or public.is_dance())
  order by p.name;
$function$;

create or replace function public.guard_salary_period_overlap()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.period_start is null or new.period_end is null
     or new.period_start > new.period_end then
    raise exception 'INVALID_SALARY_PERIOD' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.salary_records r
    where r.profile_id = new.profile_id and r.role_id = new.role_id
      and (tg_op = 'INSERT' or r.id <> old.id)
      and r.period_start <= new.period_end and new.period_start <= r.period_end
  ) then
    raise exception 'SALARY_PERIOD_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end $function$;

create or replace function public.guard_staff_salary_member_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.profile_id is distinct from old.profile_id
     or new.role_id is distinct from old.role_id
     or new.month is distinct from old.month
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.base_income_cents is distinct from old.base_income_cents
     or new.penalty_cents is distinct from old.penalty_cents
     or new.reward_cents is distinct from old.reward_cents
     or new.adjustment_cents is distinct from old.adjustment_cents
     or new.gross_cents is distinct from old.gross_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.net_cents is distinct from old.net_cents
  then
    raise exception '成员确认工资时不允许修改金额或结算相关字段';
  end if;
  return new;
end $function$;

create or replace function public.create_staff_salary_records(p_period_start date, p_period_end date, p_records jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m jsonb;
  v_profile_id uuid;
  v_role_id bigint;
  v_role_code text;
  v_base bigint;
  v_penalty bigint;
  v_reward bigint;
  v_adjust bigint;
  v_gross bigint;
  v_month date;
  v_tax bigint;
  v_net bigint;
  v_record_id uuid;
  v_status public.salary_record_status;
  v_inserted boolean;
  v_count integer := 0;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end)
     or p_period_start > p_period_end then
    raise exception 'INVALID_SALARY_PERIOD' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'INVALID_SETTLEMENT_RECORDS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    where jsonb_typeof(x) <> 'object'
       or nullif(x->>'profileId', '') is null
       or nullif(x->>'roleId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_RECORDS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    group by (x->>'profileId'), (x->>'roleId') having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_MEMBER' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    where (x ? 'penaltyCents' and jsonb_typeof(x->'penaltyCents') <> 'number')
       or (x ? 'rewardCents' and jsonb_typeof(x->'rewardCents') <> 'number')
       or (x ? 'taxCents' and jsonb_typeof(x->'taxCents') <> 'number')
  ) then
    raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
  end if;

  v_month := date_trunc('month', p_period_start)::date;

  for m in select * from jsonb_array_elements(p_records)
  loop
    v_profile_id := (m->>'profileId')::uuid;
    v_role_id := (m->>'roleId')::bigint;

    select pos.code, coalesce(sbi.base_income_cents, 0)
      into v_role_code, v_base
    from public.roles pos
    left join public.staff_base_incomes sbi
      on sbi.role_id = pos.id and sbi.profile_id = v_profile_id
    where pos.id = v_role_id;
    if v_role_code is null then
      raise exception 'INVALID_STAFF_ROLE' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.user_roles
      where profile_id = v_profile_id and role_id = v_role_id
    ) then
      raise exception 'MEMBER_ROLE_MISMATCH' using errcode = '22023';
    end if;

    v_penalty := coalesce((m->>'penaltyCents')::bigint, 0);
    v_reward := coalesce((m->>'rewardCents')::bigint, 0);
    v_tax := coalesce((m->>'taxCents')::bigint, 0);
    if v_penalty > 0 or v_reward < 0 or v_tax < 0 then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;
    v_adjust := v_penalty + v_reward;
    v_gross := v_base + v_adjust;
    v_net := v_gross - v_tax;

    select id, status into v_record_id, v_status from public.staff_salary_records
    where profile_id = v_profile_id and role_id = v_role_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
    end if;

    if v_inserted then
      insert into public.staff_salary_records (
        profile_id, role_id, month, period_start, period_end,
        base_income_cents, penalty_cents, reward_cents, adjustment_cents,
        gross_cents, tax_cents, net_cents, status, review_pending_at, note
      ) values (
        v_profile_id, v_role_id, v_month, p_period_start, p_period_end,
        v_base, v_penalty, v_reward, v_adjust,
        v_gross, v_tax, v_net, 'pending_review'::public.salary_record_status, v_now,
        nullif(trim(coalesce(m->>'note', '')), '')
      ) returning id into v_record_id;
    else
      update public.staff_salary_records set
        base_income_cents = v_base,
        penalty_cents = v_penalty,
        reward_cents = v_reward,
        adjustment_cents = v_adjust,
        gross_cents = v_gross,
        tax_cents = v_tax,
        net_cents = v_net,
        status = 'pending_review'::public.salary_record_status,
        review_pending_at = v_now,
        note = nullif(trim(coalesce(m->>'note', '')), ''),
        updated_at = v_now
      where id = v_record_id;
    end if;

    insert into public.staff_salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when v_inserted then '管理员新增工资条记录'
           else '管理员覆盖重算工资条记录' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;

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

    -- 服务率取自生效方案（手动配置），服务费 = ceil(含调整项的总工资 × 服务率)。
    d := public._anchor_compute_payroll(
      v_scheme.base_salary_cents, v_scheme.guaranteed_salary_cents,
      v_scheme.threshold_multiplier_bps, v_revenue, v_tenure,
      v_base_commission_bps, v_att_bps, v_dy_bps, v_adj_total,
      v_scheme.service_fee_rate_bps);

    if v_inserted then
      insert into public.salary_records (
        profile_id, role_id, scheme_id, month, team_id, period_start, period_end,
        revenue_cents, tenure_month, base_guarantee_cents, threshold_cents,
        commission_start_cents, commission_rate_bps, is_qualified, is_grace_period,
        guaranteed_component_cents, performance_component_cents, gross_cents,
        service_fee_cents, service_fee_rate_bps, net_cents, adjustments, status, review_pending_at,
        attendance_bonus_bps, dy_task_bonus_bps, base_commission_rate_bps, broadcast_minutes,
        note
      ) values (
        v_profile_id, v_role_id, v_scheme.id,
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
end $function$;

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
end $function$;

grant execute on function public._anchor_effective_scheme(uuid, bigint, date) to public, anon, authenticated, service_role;

-- ---------- 8. 刷新 PostgREST schema 缓存 ----------
notify pgrst, 'reload schema';
