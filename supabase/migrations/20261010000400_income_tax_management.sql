-- 个税改为「累计预扣预缴」并独立配置（个税管理）。
--
-- 口径（与产品确认）：
--   个税管理按 (成员, 月份) 保存「累计应纳税所得额」与「累计已预扣预缴税额」。
--   生成化妆师收益条时：本月累计应纳税所得额 = 上月累计 + 本月实发收益（同年；隔年/无上月则从 0 重置）；
--   本月应交个税 = 累计预扣税额(本月累计应纳税所得额) − 上月累计已预扣（不小于 0）；
--   本月累计已预扣 = 上月累计已预扣 + 本月应交个税。
--   累计预扣税额用居民个人工资薪金「累计预扣法」七级预扣率表。
--
-- 个税管理仅管理员可看/改。

-- ---------- 1. 个税记录表（个税管理） ----------
create table public.income_tax_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tax_month date not null check (tax_month = date_trunc('month', tax_month)::date),
  -- 累计应纳税所得额（分，>=0）。
  cumulative_taxable_cents bigint not null default 0 check (cumulative_taxable_cents >= 0),
  -- 累计已预扣预缴税额（分，>=0）。
  cumulative_withheld_cents bigint not null default 0 check (cumulative_withheld_cents >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, tax_month)
);
create index income_tax_records_month_idx on public.income_tax_records(tax_month desc);
create index income_tax_records_profile_idx on public.income_tax_records(profile_id);

-- ---------- 2. 累计预扣税额函数（分） ----------
-- 累计预扣预缴应纳税所得额 → 累计应预扣预缴税额：
--   ≤36000 · 3% · 0；≤144000 · 10% · 2520；≤300000 · 20% · 16920；≤420000 · 25% · 31920；
--   ≤660000 · 30% · 52920；≤960000 · 35% · 85920；>960000 · 45% · 181920。
create or replace function public.cumulative_income_tax_cents(p_cumulative_taxable_cents bigint)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  v_taxable bigint := greatest(0, coalesce(p_cumulative_taxable_cents, 0));
  v_rate integer;
  v_quick bigint;
begin
  if v_taxable <= 3600000 then v_rate := 300; v_quick := 0;
  elsif v_taxable <= 14400000 then v_rate := 1000; v_quick := 252000;
  elsif v_taxable <= 30000000 then v_rate := 2000; v_quick := 1692000;
  elsif v_taxable <= 42000000 then v_rate := 2500; v_quick := 3192000;
  elsif v_taxable <= 66000000 then v_rate := 3000; v_quick := 5292000;
  elsif v_taxable <= 96000000 then v_rate := 3500; v_quick := 8592000;
  else v_rate := 4500; v_quick := 18192000;
  end if;
  return greatest(0, round((v_taxable::numeric * v_rate) / 10000)::bigint - v_quick);
end $$;
revoke all on function public.cumulative_income_tax_cents(bigint) from public, anon;

-- 旧的按月个税函数不再使用。
drop function if exists public.individual_income_tax_cents(bigint, bigint);

-- ---------- 3. 新增/覆盖化妆师收益记录：累计预扣 ----------
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
  v_prev_taxable bigint;
  v_prev_withheld bigint;
  v_cum_taxable bigint;
  v_tax bigint;
  v_cum_withheld bigint;
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

    -- 上月（同年）累计；隔年或缺失从 0 重置。
    select cumulative_taxable_cents, cumulative_withheld_cents
      into v_prev_taxable, v_prev_withheld
    from public.income_tax_records
    where profile_id = v_makeup_id
      and tax_month = (v_month - interval '1 month')::date
      and date_trunc('year', tax_month) = date_trunc('year', v_month);
    if not found then
      v_prev_taxable := 0;
      v_prev_withheld := 0;
    end if;

    v_cum_taxable := greatest(0, v_prev_taxable + v_gross);
    v_tax := greatest(0, public.cumulative_income_tax_cents(v_cum_taxable) - v_prev_withheld);
    v_cum_withheld := v_prev_withheld + v_tax;
    v_net := v_gross - v_tax;

    insert into public.income_tax_records
      (profile_id, tax_month, cumulative_taxable_cents, cumulative_withheld_cents, updated_at)
    values (v_makeup_id, v_month, v_cum_taxable, v_cum_withheld, v_now)
    on conflict (profile_id, tax_month) do update
      set cumulative_taxable_cents = excluded.cumulative_taxable_cents,
          cumulative_withheld_cents = excluded.cumulative_withheld_cents,
          updated_at = v_now;

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

-- ---------- 4. 驳回重算：累计预扣 ----------
create or replace function public.recompute_makeup_salary_record(
  p_id uuid,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.makeup_salary_records%rowtype;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_month date;
  v_prev_taxable bigint;
  v_prev_withheld bigint;
  v_cum_taxable bigint;
  v_tax bigint;
  v_cum_withheld bigint;
  v_gross bigint;
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

  v_month := rec.month;
  v_gross := rec.base_income_cents + rec.penalty_cents + rec.reward_cents;

  select cumulative_taxable_cents, cumulative_withheld_cents
    into v_prev_taxable, v_prev_withheld
  from public.income_tax_records
  where profile_id = rec.makeup_profile_id
    and tax_month = (v_month - interval '1 month')::date
    and date_trunc('year', tax_month) = date_trunc('year', v_month);
  if not found then
    v_prev_taxable := 0;
    v_prev_withheld := 0;
  end if;

  v_cum_taxable := greatest(0, v_prev_taxable + v_gross);
  v_tax := greatest(0, public.cumulative_income_tax_cents(v_cum_taxable) - v_prev_withheld);
  v_cum_withheld := v_prev_withheld + v_tax;

  insert into public.income_tax_records
    (profile_id, tax_month, cumulative_taxable_cents, cumulative_withheld_cents, updated_at)
  values (rec.makeup_profile_id, v_month, v_cum_taxable, v_cum_withheld, v_now)
  on conflict (profile_id, tax_month) do update
    set cumulative_taxable_cents = excluded.cumulative_taxable_cents,
        cumulative_withheld_cents = excluded.cumulative_withheld_cents,
        updated_at = v_now;

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

-- ---------- 5. 历史回填：按成员、月份顺序重算累计与个税 ----------
alter table public.makeup_salary_records disable trigger makeup_salary_records_member_update_guard;
do $$
declare
  r record;
  v_prev_taxable bigint;
  v_prev_withheld bigint;
  v_cum_taxable bigint;
  v_tax bigint;
  v_cum_withheld bigint;
begin
  for r in
    select id, makeup_profile_id, month, gross_cents
    from public.makeup_salary_records
    order by makeup_profile_id, month, created_at
  loop
    select cumulative_taxable_cents, cumulative_withheld_cents
      into v_prev_taxable, v_prev_withheld
    from public.income_tax_records
    where profile_id = r.makeup_profile_id
      and tax_month = (r.month - interval '1 month')::date
      and date_trunc('year', tax_month) = date_trunc('year', r.month);
    if not found then
      v_prev_taxable := 0;
      v_prev_withheld := 0;
    end if;
    v_cum_taxable := greatest(0, v_prev_taxable + r.gross_cents);
    v_tax := greatest(0, public.cumulative_income_tax_cents(v_cum_taxable) - v_prev_withheld);
    v_cum_withheld := v_prev_withheld + v_tax;
    insert into public.income_tax_records
      (profile_id, tax_month, cumulative_taxable_cents, cumulative_withheld_cents)
    values (r.makeup_profile_id, r.month, v_cum_taxable, v_cum_withheld)
    on conflict (profile_id, tax_month) do update
      set cumulative_taxable_cents = excluded.cumulative_taxable_cents,
          cumulative_withheld_cents = excluded.cumulative_withheld_cents,
          updated_at = now();
    update public.makeup_salary_records
      set tax_cents = v_tax, net_cents = r.gross_cents - v_tax
      where id = r.id;
  end loop;
end $$;
alter table public.makeup_salary_records enable trigger makeup_salary_records_member_update_guard;

-- ---------- 6. RLS：个税管理仅管理员 ----------
alter table public.income_tax_records enable row level security;

create policy income_tax_records_admin_select on public.income_tax_records for select to authenticated
  using (public.is_admin());
create policy income_tax_records_admin_insert on public.income_tax_records for insert to authenticated
  with check (public.is_admin());
create policy income_tax_records_admin_update on public.income_tax_records for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy income_tax_records_admin_delete on public.income_tax_records for delete to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.income_tax_records to authenticated;
grant all on public.income_tax_records to service_role;
revoke all on public.income_tax_records from anon;
