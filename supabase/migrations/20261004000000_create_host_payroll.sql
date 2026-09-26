-- 主持工资核算（主持管理 + 主持流水 + 独立主持工资表）。
--
-- 与主播工资（salary_records）完全独立：
--   * 主持按「团总流水」整体计提，规则（已与产品确认）：
--       是否达标   = 团总流水 >= 拿提点门槛
--       阶梯式提点 = MAX(0, MIN(3, FLOOR((团总流水 - 拿提点门槛) / 10 万元))) × 1 个点
--       最终提成率 = 基础提成率 + 阶梯式提点
--       基础收益   = 方案配置的固定保底（仅未达标时计入）
--       实发收益   = 达标 ? floor(团总流水 × 最终提成率) : 基础收益，再加调整合计（违约+奖励）
--       服务费     = ceil(实发收益 × 服务率)
--       到手收益   = 实发收益 - 服务费
--   * 团总流水 = 该主持名下所有团队在周期内的主播流水合计（anchor_revenue_records.host_profile_id）。
--   * 工资由管理员在「主持流水」页手动结算，数据库权威重算并落 host_salary_records 四态审核流。
--
-- 复用 salary_record_status 四态枚举与 public._payroll_rate_ceil/floor 取整工具。

-- ---------- 1. 主持工资方案（主持管理，按人配置 + 岗位模板） ----------
create table public.host_salary_schemes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete restrict,
  position_id bigint references public.positions(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  version integer not null check (version > 0),
  -- 基础收益（分）：未达标时的固定保底。
  base_income_cents bigint not null default 0 check (base_income_cents >= 0),
  -- 拿提点门槛（分）：团总流水达到该值才算达标。
  commission_start_cents bigint not null default 0 check (commission_start_cents >= 0),
  -- 基础提成率（基点）。
  base_commission_rate_bps integer not null default 2000 check (base_commission_rate_bps between 1 and 10000),
  -- 服务率（基点）。
  service_fee_rate_bps integer not null default 300 check (service_fee_rate_bps between 0 and 10000),
  effective_from date not null,
  status public.scheme_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (name, version)
);
create index host_salary_schemes_profile_idx
  on public.host_salary_schemes(profile_id, position_id, effective_from desc);

-- ---------- 2. 主持工资记录（独立工资表，四态审核） ----------
create table public.host_salary_records (
  id uuid primary key default gen_random_uuid(),
  host_profile_id uuid not null references public.profiles(id) on delete restrict,
  scheme_id uuid references public.host_salary_schemes(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  period_start date not null,
  period_end date not null,
  -- 团总流水（分，该主持跨团队周期流水合计）。
  revenue_cents bigint not null check (revenue_cents >= 0),
  -- 周期内总直播时长（分钟，所有团队合计）。
  broadcast_minutes integer not null default 0 check (broadcast_minutes >= 0),
  -- 按团队拆分明细：[{ teamId, teamName, revenueCents, broadcastMinutes }]。
  team_breakdown jsonb not null default '[]'::jsonb,
  -- 拿提点门槛（分）。
  threshold_cents bigint not null check (threshold_cents >= 0),
  is_qualified boolean not null,
  base_commission_rate_bps integer not null check (base_commission_rate_bps between 1 and 10000),
  -- 阶梯式提点（基点，0/100/200/300）。
  tier_bonus_bps integer not null default 0 check (tier_bonus_bps between 0 and 300),
  -- 最终提成率（基点）。
  commission_rate_bps integer not null check (commission_rate_bps between 1 and 2147483647),
  -- 基础收益（分，方案配置的固定保底；无论是否达标均快照展示）。
  base_income_cents bigint not null default 0 check (base_income_cents >= 0),
  -- 调整项明细：[{ name, amountCents }]，违约（负）+ 奖励（正）。
  adjustments jsonb not null default '[]'::jsonb,
  -- 实发收益（分）。
  gross_cents bigint not null,
  -- 服务率（基点）。
  service_fee_rate_bps integer not null default 300 check (service_fee_rate_bps between 0 and 10000),
  -- 服务费（分）。
  service_fee_cents bigint not null,
  -- 到手收益（分）。
  net_cents bigint not null,
  status public.salary_record_status not null default 'pending_review',
  review_pending_at timestamptz,
  confirm_pending_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (host_profile_id, period_start, period_end)
);
create index host_salary_records_period_idx
  on public.host_salary_records(period_start desc, period_end desc);
create index host_salary_records_host_idx
  on public.host_salary_records(host_profile_id);

-- ---------- 3. 主持工资状态日志 ----------
create table public.host_salary_record_status_logs (
  id uuid primary key default gen_random_uuid(),
  salary_record_id uuid not null references public.host_salary_records(id) on delete cascade,
  from_status public.salary_record_status,
  to_status public.salary_record_status not null,
  operator_profile_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index host_salary_record_status_logs_record_idx
  on public.host_salary_record_status_logs(salary_record_id, created_at);

-- ---------- 4. 计算核心：给定已解析输入产出主持工资明细（纯计算） ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'host_payroll_detail') then
    create type public.host_payroll_detail as (
      threshold_cents bigint,
      is_qualified boolean,
      tier_steps integer,
      tier_bonus_bps integer,
      commission_rate_bps integer,
      base_income_cents bigint,
      performance_component_cents bigint,
      gross_cents bigint,
      service_fee_cents bigint,
      net_cents bigint
    );
  end if;
end $$;

create or replace function public._host_compute_payroll(
  p_base_income_cents bigint,
  p_commission_start_cents bigint,
  p_base_commission_rate_bps integer,
  p_service_fee_rate_bps integer,
  p_revenue_cents bigint,
  p_adjustment_total_cents bigint
)
returns public.host_payroll_detail language plpgsql immutable set search_path = '' as $$
declare
  r public.host_payroll_detail;
  v_over bigint;
  v_steps integer;
  v_base_component bigint;
begin
  if p_base_commission_rate_bps is null or p_base_commission_rate_bps <= 0
     or p_base_commission_rate_bps > 10000 then
    raise exception 'INVALID_HOST_COMMISSION_BPS' using errcode = '22023';
  end if;
  if p_service_fee_rate_bps is null or p_service_fee_rate_bps < 0
     or p_service_fee_rate_bps > 10000 then
    raise exception 'INVALID_HOST_SERVICE_RATE_BPS' using errcode = '22023';
  end if;
  if p_revenue_cents < 0 or p_commission_start_cents < 0 or p_base_income_cents < 0 then
    raise exception 'INVALID_HOST_AMOUNT' using errcode = '22023';
  end if;

  r.threshold_cents := p_commission_start_cents;
  r.is_qualified := p_revenue_cents >= p_commission_start_cents;

  -- 阶梯式提点：每超出 10 万元（10,000,000 分）+1 档，最高 3 档；未达门槛为 0。
  if r.is_qualified then
    v_over := p_revenue_cents - p_commission_start_cents;
    v_steps := least(3, greatest(0, floor(v_over / 10000000)::integer));
  else
    v_steps := 0;
  end if;
  r.tier_steps := v_steps;
  r.tier_bonus_bps := v_steps * 100;

  if (p_base_commission_rate_bps::numeric + r.tier_bonus_bps) > 2147483647 then
    raise exception 'HOST_COMMISSION_RATE_OVERFLOW' using errcode = '22003';
  end if;
  r.commission_rate_bps := p_base_commission_rate_bps + r.tier_bonus_bps;

  -- 基础收益快照始终为配置值；是否计入取决于达标。
  r.base_income_cents := p_base_income_cents;

  if r.is_qualified then
    r.performance_component_cents := public._payroll_rate_floor(p_revenue_cents, r.commission_rate_bps);
    v_base_component := 0;
  else
    r.performance_component_cents := 0;
    v_base_component := p_base_income_cents;
  end if;

  r.gross_cents := v_base_component + r.performance_component_cents + p_adjustment_total_cents;
  r.service_fee_cents := public._payroll_rate_ceil(r.gross_cents, p_service_fee_rate_bps);
  r.net_cents := r.gross_cents - r.service_fee_cents;
  return r;
end $$;

-- ---------- 5. 解析器：周期流水 / 直播时长 / 团队明细 / 生效方案 ----------
create or replace function public._host_period_revenue(
  p_host_profile_id uuid, p_period_start date, p_period_end date
)
returns bigint language sql stable set search_path = '' as $$
  select coalesce(sum(revenue_cents), 0)::bigint
  from public.anchor_revenue_records
  where host_profile_id = p_host_profile_id
    and no_perf = false
    and perf_date between p_period_start and p_period_end;
$$;

create or replace function public._host_period_broadcast_minutes(
  p_host_profile_id uuid, p_period_start date, p_period_end date
)
returns integer language sql stable set search_path = '' as $$
  select coalesce(sum(broadcast_minutes), 0)::integer
  from public.anchor_revenue_records
  where host_profile_id = p_host_profile_id
    and perf_date between p_period_start and p_period_end;
$$;

create or replace function public._host_period_team_breakdown(
  p_host_profile_id uuid, p_period_start date, p_period_end date
)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'teamId', x.team_id,
        'teamName', x.team_name,
        'revenueCents', x.revenue_cents,
        'broadcastMinutes', x.broadcast_minutes
      ) order by x.revenue_cents desc, x.team_name
    ),
    '[]'::jsonb
  )
  from (
    select r.team_id,
           max(t.name) as team_name,
           coalesce(sum(case when r.no_perf = false then r.revenue_cents else 0 end), 0)::bigint as revenue_cents,
           coalesce(sum(r.broadcast_minutes), 0)::integer as broadcast_minutes
    from public.anchor_revenue_records r
    left join public.teams t on t.id = r.team_id
    where r.host_profile_id = p_host_profile_id
      and r.perf_date between p_period_start and p_period_end
    group by r.team_id
  ) x;
$$;

create or replace function public._host_effective_scheme(
  p_profile_id uuid, p_period_end date
)
returns public.host_salary_schemes language sql stable set search_path = '' as $$
  select * from public.host_salary_schemes
  where status = 'active'
    and effective_from <= p_period_end
    and (profile_id = p_profile_id or profile_id is null)
  order by (profile_id is not null) desc, effective_from desc, version desc, id
  limit 1;
$$;

-- ---------- 6. 结算 RPC：数据库权威重算落库（前端仅传主持 + 调整项） ----------
-- p_hosts 每项：{ hostProfileId, adjustments?: [{ name, amountCents }] }
create or replace function public.settle_host_payroll(
  p_period_start date, p_period_end date, p_hosts jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.system_settlement_settings%rowtype;
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

  select * into s from public.system_settlement_settings where id for update;
  if not found then raise exception 'SYSTEM_SETTLEMENT_SETTINGS_MISSING'; end if;
  update public.system_settlement_settings set updated_at = updated_at where id;

  if p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end) then
    raise exception 'INVALID_SETTLEMENT_PERIOD' using errcode = '22023';
  end if;
  if extract(day from p_period_start)::integer <>
       (case when s.settlement_type = 'monthly' then 1 else s.settlement_start_day end)
     or p_period_end <> (p_period_start + interval '1 month')::date - 1 then
    raise exception 'SETTLEMENT_PERIOD_MUST_MATCH_SYSTEM' using errcode = '22023';
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

revoke all on function public.settle_host_payroll(date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.settle_host_payroll(date, date, jsonb) to authenticated;

-- ---------- 7. 驳回重算 RPC ----------
create or replace function public.recompute_host_salary_record(
  p_id uuid,
  p_adjustments jsonb default null,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.host_salary_records%rowtype;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_adjustments jsonb;
  v_adj_total bigint;
  v_scheme public.host_salary_schemes%rowtype;
  v_revenue bigint;
  v_broadcast integer;
  v_breakdown jsonb;
  d public.host_payroll_detail;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;

  select * into rec from public.host_salary_records where id = p_id for update;
  if not found then
    raise exception 'HOST_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if rec.status <> 'pending_review'::public.salary_record_status then
    raise exception 'INVALID_TRANSITION:%->pending_review', rec.status using errcode = '22023';
  end if;

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

  v_scheme := public._host_effective_scheme(rec.host_profile_id, rec.period_end);
  if v_scheme.id is null then
    raise exception 'HOST_SALARY_SCHEME_MISSING' using errcode = 'P0002';
  end if;

  v_revenue := public._host_period_revenue(rec.host_profile_id, rec.period_start, rec.period_end);
  v_broadcast := public._host_period_broadcast_minutes(rec.host_profile_id, rec.period_start, rec.period_end);
  v_breakdown := public._host_period_team_breakdown(rec.host_profile_id, rec.period_start, rec.period_end);

  d := public._host_compute_payroll(
    v_scheme.base_income_cents, v_scheme.commission_start_cents,
    v_scheme.base_commission_rate_bps, v_scheme.service_fee_rate_bps,
    v_revenue, v_adj_total);

  update public.host_salary_records
  set scheme_id = v_scheme.id,
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
      review_pending_at = v_now,
      updated_at = v_now
  where id = p_id;

  insert into public.host_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review'::public.salary_record_status,
          'pending_review'::public.salary_record_status, v_operator,
          coalesce(p_note, '管理员驳回，已按当前流水由数据库权威重算'));
end $$;

revoke all on function public.recompute_host_salary_record(uuid, jsonb, text)
  from public, anon, service_role;
grant execute on function public.recompute_host_salary_record(uuid, jsonb, text)
  to authenticated;

-- ---------- 8. 状态流转 RPC（四态，复用 salary_record_status） ----------
create or replace function public.transition_host_salary_status(
  p_id uuid,
  p_to_status public.salary_record_status,
  p_operator_profile_id uuid default null,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_from public.salary_record_status;
  v_host_id uuid;
  v_is_admin boolean := public.is_admin();
  v_caller uuid := public.current_profile_id();
  v_operator uuid;
  v_now timestamptz := now();
begin
  select status, host_profile_id into v_from, v_host_id
  from public.host_salary_records
  where id = p_id
  for update;

  if not found then
    raise exception 'HOST_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if v_host_id is distinct from v_caller
       or v_from <> 'pending_confirm'
       or p_to_status <> 'confirmed' then
      raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  v_operator := case when v_is_admin then coalesce(p_operator_profile_id, v_caller) else v_caller end;

  if not (
       (v_from = 'pending_review'  and p_to_status = 'pending_confirm')
    or (v_from = 'pending_confirm' and p_to_status = 'confirmed')
    or (v_from = 'confirmed'       and p_to_status = 'completed')
  ) then
    raise exception 'INVALID_TRANSITION:%->%', v_from, p_to_status
      using errcode = '22023';
  end if;

  update public.host_salary_records
  set status = p_to_status,
      updated_at = v_now,
      confirm_pending_at = case when p_to_status = 'pending_confirm' then v_now else confirm_pending_at end,
      confirmed_at       = case when p_to_status = 'confirmed'       then v_now else confirmed_at end,
      completed_at       = case when p_to_status = 'completed'       then v_now else completed_at end,
      reviewed_by  = case when p_to_status = 'pending_confirm' and v_operator is not null then v_operator else reviewed_by end,
      confirmed_by = case when p_to_status = 'confirmed'       and v_operator is not null then v_operator else confirmed_by end,
      completed_by = case when p_to_status = 'completed'       and v_operator is not null then v_operator else completed_by end
  where id = p_id and status = v_from;

  insert into public.host_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, v_from, p_to_status, v_operator, p_note);

  if p_to_status = 'pending_confirm' then
    insert into public.notifications (profile_id, type, title, body, ref_id)
    values (v_host_id, 'payslip_pending', '工资条待确认', '您有一份新的工资条待确认，请及时查看。', p_id);
  end if;
end $$;

revoke all on function public.transition_host_salary_status(uuid, public.salary_record_status, uuid, text)
  from public, anon, service_role;
grant execute on function public.transition_host_salary_status(uuid, public.salary_record_status, uuid, text)
  to authenticated;

-- ---------- 9. RLS ----------
alter table public.host_salary_schemes enable row level security;
alter table public.host_salary_records enable row level security;
alter table public.host_salary_record_status_logs enable row level security;

create policy host_schemes_select on public.host_salary_schemes for select to authenticated
  using (public.is_admin() or profile_id = public.current_profile_id());
create policy host_schemes_insert on public.host_salary_schemes for insert to authenticated
  with check (public.is_admin());
create policy host_schemes_update on public.host_salary_schemes for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy host_salary_records_select on public.host_salary_records for select to authenticated
  using (
    public.is_admin()
    or (host_profile_id = public.current_profile_id() and status <> 'pending_review')
  );
create policy host_salary_records_insert on public.host_salary_records for insert to authenticated
  with check (public.is_admin());
create policy host_salary_records_update on public.host_salary_records for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy host_salary_records_member_confirm on public.host_salary_records for update to authenticated
  using (host_profile_id = public.current_profile_id() and status = 'pending_confirm')
  with check (host_profile_id = public.current_profile_id() and status = 'confirmed');

-- 非管理员更新时，除 status / confirmed_at / confirmed_by / updated_at 外的列必须保持不变。
create or replace function public.guard_host_salary_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.host_profile_id is distinct from old.host_profile_id
     or new.scheme_id is distinct from old.scheme_id
     or new.month is distinct from old.month
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.revenue_cents is distinct from old.revenue_cents
     or new.broadcast_minutes is distinct from old.broadcast_minutes
     or new.team_breakdown is distinct from old.team_breakdown
     or new.threshold_cents is distinct from old.threshold_cents
     or new.is_qualified is distinct from old.is_qualified
     or new.base_commission_rate_bps is distinct from old.base_commission_rate_bps
     or new.tier_bonus_bps is distinct from old.tier_bonus_bps
     or new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.base_income_cents is distinct from old.base_income_cents
     or new.adjustments is distinct from old.adjustments
     or new.gross_cents is distinct from old.gross_cents
     or new.service_fee_rate_bps is distinct from old.service_fee_rate_bps
     or new.service_fee_cents is distinct from old.service_fee_cents
     or new.net_cents is distinct from old.net_cents
  then
    raise exception '成员确认工资时不允许修改金额或结算相关字段';
  end if;
  return new;
end $$;

create trigger host_salary_records_member_update_guard
  before update on public.host_salary_records
  for each row execute function public.guard_host_salary_member_update();

create policy host_salary_logs_select on public.host_salary_record_status_logs for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.host_salary_records r
      where r.id = host_salary_record_status_logs.salary_record_id
        and r.host_profile_id = public.current_profile_id()
    )
  );
create policy host_salary_logs_insert on public.host_salary_record_status_logs for insert to authenticated
  with check (public.is_admin());

-- ---------- 10. 授权 ----------
grant select, insert, update on public.host_salary_schemes to authenticated;
grant select, insert, update on public.host_salary_records to authenticated;
grant select, insert on public.host_salary_record_status_logs to authenticated;
grant all on public.host_salary_schemes to service_role;
grant all on public.host_salary_records to service_role;
grant all on public.host_salary_record_status_logs to service_role;
revoke all on public.host_salary_schemes from anon;
revoke all on public.host_salary_records from anon;
revoke all on public.host_salary_record_status_logs from anon;
