-- 新增「人事主管」角色：可设置各人事成员的每日调整项，并生成人事工资条。
--
-- 1) roles 增加 hr_manager；is_hr_manager() 判定。
-- 2) staff_adjustment_records：人事每日调整项（任意命名、可正可负；全部进工资条）。
-- 3) list_staff_members / list_staff_adjustments / set_staff_adjustments。
-- 4) create_staff_salary_records 放行 hr_manager，但仅限角色 code='hr'。

-- ---------- 1. 新角色 + 判定函数 ----------
insert into public.roles (code, name, default_permissions)
values ('hr_manager', '人事主管', array['self.payslip.read'])
on conflict (code) do nothing;

create or replace function public.is_hr_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_roles up
    join public.roles r on r.id = up.role_id
    where up.profile_id = public.current_profile_id() and r.code = 'hr_manager'
  );
$$;
revoke all on function public.is_hr_manager() from public, anon;
grant execute on function public.is_hr_manager() to authenticated;

-- ---------- 2. 人事每日调整项表 ----------
create table if not exists public.staff_adjustment_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_code text not null default 'hr',
  adjust_date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -1000000000 and 1000000000),
  registered_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_adjustment_records_date_idx
  on public.staff_adjustment_records(adjust_date desc);
create index if not exists staff_adjustment_records_profile_idx
  on public.staff_adjustment_records(profile_id);
create index if not exists staff_adjustment_records_target_idx
  on public.staff_adjustment_records(profile_id, adjust_date, role_code);

-- ---------- 3. 某角色在职成员（含当前基础薪资） ----------
create or replace function public.list_staff_members(p_role_code text)
returns table(id uuid, name text, base_income_cents bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, coalesce(sbi.base_income_cents, 0)
  from public.profiles p
  join public.user_roles up on up.profile_id = p.id
  join public.roles r on r.id = up.role_id
  left join public.staff_base_incomes sbi on sbi.profile_id = p.id and sbi.role_id = r.id
  where r.code = p_role_code
    and p.status = 'active'
    and (public.is_admin() or public.is_hr_manager())
  order by p.name;
$$;
revoke all on function public.list_staff_members(text) from public, anon;
grant execute on function public.list_staff_members(text) to authenticated;

-- ---------- 4. 查询人事每日调整项 ----------
create or replace function public.list_staff_adjustments(
  p_role_code text default 'hr',
  p_start date default null,
  p_end date default null
)
returns table(
  id uuid,
  profile_id uuid,
  profile_name text,
  role_code text,
  adjust_date date,
  name text,
  amount_cents bigint,
  registered_by uuid,
  registered_name text,
  note text,
  updated_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select a.id, a.profile_id, p.name, a.role_code, a.adjust_date, a.name, a.amount_cents,
         a.registered_by, r.name, a.note, a.updated_at
  from public.staff_adjustment_records a
  join public.profiles p on p.id = a.profile_id
  left join public.profiles r on r.id = a.registered_by
  where (public.is_admin() or public.is_hr_manager())
    and a.role_code = p_role_code
    and (p_start is null or a.adjust_date >= p_start)
    and (p_end is null or a.adjust_date <= p_end)
  order by a.adjust_date desc, p.name, a.name;
$$;
revoke all on function public.list_staff_adjustments(text, date, date) from public, anon;
grant execute on function public.list_staff_adjustments(text, date, date) to authenticated;

-- ---------- 5. 批量设置人事每日调整项（按成员+日期整体覆盖） ----------
-- p_entries: [{ "profileId": uuid, "items": [{ "name": text, "amountCents": bigint, "note"?: text }] }]
create or replace function public.set_staff_adjustments(
  p_role_code text,
  p_date date,
  p_entries jsonb,
  p_registered_by uuid default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  it jsonb;
  v_profile uuid;
  v_name text;
  v_amount bigint;
  v_registered_by uuid;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if not (public.is_admin() or public.is_hr_manager()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_role_code is null or btrim(p_role_code) = '' then
    raise exception 'INVALID_ROLE_CODE' using errcode = '22023';
  end if;
  if p_date is null or not isfinite(p_date) then
    raise exception 'INVALID_ADJUSTMENT_DATE' using errcode = '22023';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'INVALID_ADJUSTMENT_ENTRIES' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) x
    where jsonb_typeof(x) <> 'object' or nullif(x->>'profileId', '') is null
  ) then
    raise exception 'INVALID_ADJUSTMENT_ENTRIES' using errcode = '22023';
  end if;

  v_registered_by := coalesce(p_registered_by, v_operator);

  for e in select * from jsonb_array_elements(p_entries)
  loop
    v_profile := (e->>'profileId')::uuid;
    delete from public.staff_adjustment_records
      where profile_id = v_profile and adjust_date = p_date and role_code = btrim(p_role_code);

    if jsonb_typeof(e->'items') = 'array' then
      for it in select * from jsonb_array_elements(e->'items')
      loop
        v_name := btrim(coalesce(it->>'name', ''));
        if v_name = '' or char_length(v_name) > 50 then
          raise exception 'INVALID_ADJUSTMENT_NAME' using errcode = '22023';
        end if;
        if jsonb_typeof(it->'amountCents') is distinct from 'number'
           or trunc((it->>'amountCents')::numeric) <> (it->>'amountCents')::numeric then
          raise exception 'INVALID_ADJUSTMENT_AMOUNT' using errcode = '22023';
        end if;
        v_amount := (it->>'amountCents')::bigint;
        if v_amount = 0 then
          raise exception 'INVALID_ADJUSTMENT_AMOUNT' using errcode = '22023';
        end if;

        insert into public.staff_adjustment_records
          (profile_id, role_code, adjust_date, name, amount_cents, registered_by, note, updated_at)
        values
          (v_profile, btrim(p_role_code), p_date, v_name, v_amount, v_registered_by,
           nullif(btrim(coalesce(it->>'note', '')), ''), v_now);
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_staff_adjustments(text, date, jsonb, uuid) from public, anon;
grant execute on function public.set_staff_adjustments(text, date, jsonb, uuid) to authenticated;

-- ---------- 6. create_staff_salary_records 放行 hr_manager（仅限角色 hr） ----------
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
  if not (public.is_admin() or public.is_hr_manager()) then
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
    -- 人事主管仅能生成「人事」角色的工资条。
    if public.is_admin() is not true and v_role_code <> 'hr' then
      raise exception 'FORBIDDEN_ROLE' using errcode = '42501';
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

-- ---------- 7. RLS 与授权 ----------
alter table public.staff_adjustment_records enable row level security;
create policy staff_adjustment_records_select on public.staff_adjustment_records for select to authenticated
  using (public.is_admin() or public.is_hr_manager());
grant select on public.staff_adjustment_records to authenticated;
grant all on public.staff_adjustment_records to service_role;
revoke all on public.staff_adjustment_records from anon;

notify pgrst, 'reload schema';
