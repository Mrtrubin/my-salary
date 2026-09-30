-- 化妆师收益加入个人所得税：
--   tax_cents = 个税函数(gross_cents)，net_cents = gross_cents − tax_cents。
-- 个税公式与中国·工资薪金月度税率表一致（起征点 5000 元），公共函数
-- public.individual_income_tax_cents 为唯一权威实现（前端 lib/domain/payroll/tax.ts 同口径）。

-- ---------- 1. 个税计算函数（分） ----------
create or replace function public.individual_income_tax_cents(
  p_income_cents bigint,
  p_threshold_cents bigint default 500000
)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  v_taxable bigint;
  v_rate integer;
  v_quick bigint;
begin
  if p_threshold_cents is null or p_threshold_cents < 0 then
    raise exception 'INVALID_TAX_THRESHOLD' using errcode = '22023';
  end if;
  v_taxable := coalesce(p_income_cents, 0) - p_threshold_cents;
  if v_taxable <= 0 then
    return 0;
  end if;
  if v_taxable <= 300000 then v_rate := 300; v_quick := 0;
  elsif v_taxable <= 1200000 then v_rate := 1000; v_quick := 21000;
  elsif v_taxable <= 2500000 then v_rate := 2000; v_quick := 141000;
  elsif v_taxable <= 3500000 then v_rate := 2500; v_quick := 266000;
  elsif v_taxable <= 5500000 then v_rate := 3000; v_quick := 441000;
  elsif v_taxable <= 8000000 then v_rate := 3500; v_quick := 716000;
  else v_rate := 4500; v_quick := 1516000;
  end if;
  return greatest(0, round((v_taxable::numeric * v_rate) / 10000)::bigint - v_quick);
end $$;
revoke all on function public.individual_income_tax_cents(bigint, bigint) from public, anon;

-- ---------- 2. 加列 + 回填历史 ----------
alter table public.makeup_salary_records
  add column if not exists tax_cents bigint not null default 0 check (tax_cents >= 0);

-- 迁移回填会改 tax_cents/net_cents，需临时停用成员确认守卫（非管理员上下文）。
alter table public.makeup_salary_records disable trigger makeup_salary_records_member_update_guard;
update public.makeup_salary_records
set tax_cents = public.individual_income_tax_cents(gross_cents),
    net_cents = gross_cents - public.individual_income_tax_cents(gross_cents);
alter table public.makeup_salary_records enable trigger makeup_salary_records_member_update_guard;

-- ---------- 3. 新增/覆盖记录：计算个税 ----------
create or replace function public.create_makeup_salary_records(
  p_period_start date,
  p_period_end date,
  p_records jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  v_makeup_id uuid;
  v_base bigint;
  v_penalty bigint;
  v_reward bigint;
  v_adjust bigint;
  v_gross bigint;
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
    where jsonb_typeof(x) <> 'object' or nullif(x->>'makeupProfileId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_RECORDS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    group by x->>'makeupProfileId' having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_MEMBER' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    where (x ? 'penaltyCents' and jsonb_typeof(x->'penaltyCents') <> 'number')
       or (x ? 'rewardCents' and jsonb_typeof(x->'rewardCents') <> 'number')
  ) then
    raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_records)
  loop
    v_makeup_id := (m->>'makeupProfileId')::uuid;

    select makeup_base_income_cents into v_base
    from public.profiles where id = v_makeup_id;
    if not found then
      raise exception 'MAKEUP_PROFILE_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_penalty := coalesce((m->>'penaltyCents')::bigint, 0);
    v_reward := coalesce((m->>'rewardCents')::bigint, 0);
    if v_penalty > 0 or v_reward < 0 then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;
    v_adjust := v_penalty + v_reward;
    v_gross := v_base + v_adjust;
    v_tax := public.individual_income_tax_cents(v_gross);
    v_net := v_gross - v_tax;

    select id, status into v_record_id, v_status from public.makeup_salary_records
    where makeup_profile_id = v_makeup_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
    end if;

    if v_inserted then
      insert into public.makeup_salary_records (
        makeup_profile_id, month, period_start, period_end,
        base_income_cents, penalty_cents, reward_cents, adjustment_cents,
        gross_cents, tax_cents, net_cents, status, review_pending_at, note
      ) values (
        v_makeup_id, date_trunc('month', p_period_start)::date, p_period_start, p_period_end,
        v_base, v_penalty, v_reward, v_adjust,
        v_gross, v_tax, v_net, 'pending_review'::public.salary_record_status, v_now,
        nullif(trim(coalesce(m->>'note', '')), '')
      ) returning id into v_record_id;
    else
      update public.makeup_salary_records set
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

    insert into public.makeup_salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when v_inserted then '管理员新增化妆师收益记录'
           else '管理员覆盖重算化妆师收益记录' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.create_makeup_salary_records(date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.create_makeup_salary_records(date, date, jsonb)
  to authenticated;

-- ---------- 4. 驳回重算：重算个税 ----------
create or replace function public.recompute_makeup_salary_record(
  p_id uuid,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.makeup_salary_records%rowtype;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_gross bigint;
  v_tax bigint;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;
  select * into rec from public.makeup_salary_records where id = p_id for update;
  if not found then
    raise exception 'MAKEUP_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if rec.status <> 'pending_review'::public.salary_record_status then
    raise exception 'INVALID_TRANSITION:%->pending_review', rec.status using errcode = '22023';
  end if;
  v_gross := rec.base_income_cents + rec.penalty_cents + rec.reward_cents;
  v_tax := public.individual_income_tax_cents(v_gross);
  update public.makeup_salary_records set
    adjustment_cents = rec.penalty_cents + rec.reward_cents,
    gross_cents = v_gross,
    tax_cents = v_tax,
    net_cents = v_gross - v_tax,
    status = 'pending_review'::public.salary_record_status,
    review_pending_at = v_now,
    updated_at = v_now
  where id = p_id;
  insert into public.makeup_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review'::public.salary_record_status,
          'pending_review'::public.salary_record_status, v_operator,
          coalesce(p_note, '管理员驳回，已重新计算化妆师收益'));
end $$;
revoke all on function public.recompute_makeup_salary_record(uuid, text)
  from public, anon, service_role;
grant execute on function public.recompute_makeup_salary_record(uuid, text)
  to authenticated;

-- ---------- 5. 成员确认守卫：个税列同样不可改 ----------
create or replace function public.guard_makeup_salary_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.makeup_profile_id is distinct from old.makeup_profile_id
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
end $$;
revoke all on function public.guard_makeup_salary_member_update() from public, anon, authenticated;
