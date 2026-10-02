-- 基础薪资改为「按 (成员, 职位) 通用存储」，使「职位管理」新增的任意职位都能在
-- 「基础薪资管理」设置、并在「工资核算」按「固定薪资 + 调整项」结算。
--
-- 旧实现把各职位基础薪资写死在 profiles 的固定列（makeup/dance/executive/camera/hr），
-- 新增职位无法落库。此迁移：
--   1. 新建 staff_base_incomes 通用表并迁移旧列数据；
--   2. 重写 set_staff_base_income（按 code 定位职位后 upsert）；
--   3. 重写 create_staff_salary_records（基础薪资改从通用表读取，移除 CASE 白名单）；
--   4. 删除 profiles 旧职位基础薪资列。

-- ---------- 1. 通用基础薪资表 ----------
create table if not exists public.staff_base_incomes (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position_id bigint not null references public.positions(id) on delete restrict,
  base_income_cents bigint not null default 0 check (base_income_cents >= 0),
  updated_at timestamptz not null default now(),
  unique (profile_id, position_id)
);
-- unique(profile_id, position_id) 已覆盖 profile_id 前缀；position_id 外键单独建索引。
create index if not exists staff_base_incomes_position_idx
  on public.staff_base_incomes(position_id);

-- ---------- 2. 迁移旧列数据（仅迁移非零值，避免产生无意义默认行） ----------
insert into public.staff_base_incomes (profile_id, position_id, base_income_cents)
select p.id, pos.id, x.cents
from public.profiles p
join public.positions pos on pos.code in ('makeup', 'dance', 'executive', 'camera', 'hr')
join lateral (
  select case pos.code
    when 'makeup' then p.makeup_base_income_cents
    when 'dance' then p.dance_base_income_cents
    when 'executive' then p.executive_base_income_cents
    when 'camera' then p.camera_base_income_cents
    when 'hr' then p.hr_base_income_cents
  end as cents
) x on true
where x.cents > 0
on conflict (profile_id, position_id) do update
  set base_income_cents = excluded.base_income_cents,
      updated_at = now();

-- ---------- 3. 基础薪资设置 RPC（按职位 code upsert 通用表） ----------
create or replace function public.set_staff_base_income(
  p_profile_id uuid,
  p_position_code text,
  p_cents bigint
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_position_id bigint;
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_cents is null or p_cents < 0 then
    raise exception 'INVALID_BASE_INCOME' using errcode = '22023';
  end if;
  select id into v_position_id from public.positions where code = p_position_code;
  if v_position_id is null then
    raise exception 'UNSUPPORTED_POSITION:%', p_position_code using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.staff_base_incomes (profile_id, position_id, base_income_cents, updated_at)
  values (p_profile_id, v_position_id, p_cents, now())
  on conflict (profile_id, position_id) do update
    set base_income_cents = excluded.base_income_cents,
        updated_at = now();
end $$;
revoke all on function public.set_staff_base_income(uuid, text, bigint) from public, anon, service_role;
grant execute on function public.set_staff_base_income(uuid, text, bigint) to authenticated;

-- ---------- 4. 新增/覆盖固定薪资工资条（基础薪资改读通用表） ----------
-- p_records 每项：{ profileId, positionId, penaltyCents?, rewardCents?, taxCents?, note? }
create or replace function public.create_staff_salary_records(
  p_period_start date,
  p_period_end date,
  p_records jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  v_profile_id uuid;
  v_position_id bigint;
  v_position_code text;
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
       or nullif(x->>'positionId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_RECORDS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    group by (x->>'profileId'), (x->>'positionId') having count(*) > 1
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
    v_position_id := (m->>'positionId')::bigint;

    select pos.code, coalesce(sbi.base_income_cents, 0)
      into v_position_code, v_base
    from public.positions pos
    left join public.staff_base_incomes sbi
      on sbi.position_id = pos.id and sbi.profile_id = v_profile_id
    where pos.id = v_position_id;
    if v_position_code is null then
      raise exception 'INVALID_STAFF_POSITION' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.user_positions
      where profile_id = v_profile_id and position_id = v_position_id
    ) then
      raise exception 'MEMBER_POSITION_MISMATCH' using errcode = '22023';
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
    where profile_id = v_profile_id and position_id = v_position_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
    end if;

    if v_inserted then
      insert into public.staff_salary_records (
        profile_id, position_id, month, period_start, period_end,
        base_income_cents, penalty_cents, reward_cents, adjustment_cents,
        gross_cents, tax_cents, net_cents, status, review_pending_at, note
      ) values (
        v_profile_id, v_position_id, v_month, p_period_start, p_period_end,
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
end $$;
revoke all on function public.create_staff_salary_records(date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.create_staff_salary_records(date, date, jsonb)
  to authenticated;

-- ---------- 5. RLS ----------
alter table public.staff_base_incomes enable row level security;

create policy staff_base_incomes_select on public.staff_base_incomes for select to authenticated
  using (public.is_admin() or profile_id = public.current_profile_id());
create policy staff_base_incomes_admin_insert on public.staff_base_incomes for insert to authenticated
  with check (public.is_admin());
create policy staff_base_incomes_admin_update on public.staff_base_incomes for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.staff_base_incomes to authenticated;
grant all on public.staff_base_incomes to service_role;
revoke all on public.staff_base_incomes from anon;

-- ---------- 6. 删除 profiles 旧职位基础薪资列 ----------
alter table public.profiles
  drop column if exists makeup_base_income_cents,
  drop column if exists dance_base_income_cents,
  drop column if exists executive_base_income_cents,
  drop column if exists camera_base_income_cents,
  drop column if exists hr_base_income_cents;
