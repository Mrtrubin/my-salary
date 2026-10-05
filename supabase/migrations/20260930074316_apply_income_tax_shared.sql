-- 将「按工资条自动更新当月个税记录」抽成公共函数，供工资核算落库时调用。
-- 目前仅化妆师工资条接入；主播/主持暂不计个税（其结算 RPC 不调用本函数）。

create or replace function public.apply_income_tax(
  p_profile_id uuid,
  p_month date,
  p_gross_cents bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_prev_taxable bigint;
  v_prev_withheld bigint;
  v_cum_taxable bigint;
  v_tax bigint;
  v_cum_withheld bigint;
begin
  if p_profile_id is null or v_month is null then
    raise exception 'INVALID_TAX_ARGS' using errcode = '22023';
  end if;

  -- 上月（同年）累计；隔年或缺失从 0 重置。
  select cumulative_taxable_cents, cumulative_withheld_cents
    into v_prev_taxable, v_prev_withheld
  from public.income_tax_records
  where profile_id = p_profile_id
    and tax_month = (v_month - interval '1 month')::date
    and date_trunc('year', tax_month) = date_trunc('year', v_month);
  if not found then
    v_prev_taxable := 0;
    v_prev_withheld := 0;
  end if;

  v_cum_taxable := greatest(0, v_prev_taxable + coalesce(p_gross_cents, 0));
  v_tax := greatest(0, public.cumulative_income_tax_cents(v_cum_taxable) - v_prev_withheld);
  v_cum_withheld := v_prev_withheld + v_tax;

  insert into public.income_tax_records
    (profile_id, tax_month, cumulative_taxable_cents, cumulative_withheld_cents, updated_at)
  values (p_profile_id, v_month, v_cum_taxable, v_cum_withheld, now())
  on conflict (profile_id, tax_month) do update
    set cumulative_taxable_cents = excluded.cumulative_taxable_cents,
        cumulative_withheld_cents = excluded.cumulative_withheld_cents,
        updated_at = now();

  return v_tax;
end $$;
revoke all on function public.apply_income_tax(uuid, date, bigint)
  from public, anon, authenticated;

-- ---------- 化妆师新增/覆盖记录：调用公共个税函数 ----------
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

  v_month := date_trunc('month', p_period_start)::date;

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

    -- 自动更新当月个税记录并取回本期个税。
    v_tax := public.apply_income_tax(v_makeup_id, v_month, v_gross);
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
        v_makeup_id, v_month, p_period_start, p_period_end,
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

-- ---------- 化妆师驳回重算：调用公共个税函数 ----------
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
  v_tax := public.apply_income_tax(rec.makeup_profile_id, rec.month, v_gross);

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
