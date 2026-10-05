-- 人事主管：把「调整项」底层重命名为「绩效」（staff_performance_records），
-- 并允许人事主管设置「人事」角色的基础薪资。

-- ---------- 1. 表 / 索引 / 策略重命名 ----------
alter table public.staff_adjustment_records rename to staff_performance_records;
alter index public.staff_adjustment_records_date_idx rename to staff_performance_records_date_idx;
alter index public.staff_adjustment_records_profile_idx rename to staff_performance_records_profile_idx;
alter index public.staff_adjustment_records_target_idx rename to staff_performance_records_target_idx;
alter policy staff_adjustment_records_select on public.staff_performance_records
  rename to staff_performance_records_select;

-- ---------- 2. 查询 RPC 重命名并改用新表 ----------
drop function if exists public.list_staff_adjustments(text, date, date);
create function public.list_staff_performance(
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
  from public.staff_performance_records a
  join public.profiles p on p.id = a.profile_id
  left join public.profiles r on r.id = a.registered_by
  where (public.is_admin() or public.is_hr_manager())
    and a.role_code = p_role_code
    and (p_start is null or a.adjust_date >= p_start)
    and (p_end is null or a.adjust_date <= p_end)
  order by a.adjust_date desc, p.name, a.name;
$$;
revoke all on function public.list_staff_performance(text, date, date) from public, anon;
grant execute on function public.list_staff_performance(text, date, date) to authenticated;

-- ---------- 3. 设置 RPC 重命名并改用新表 ----------
drop function if exists public.set_staff_adjustments(text, date, jsonb, uuid);
create function public.set_staff_performance(
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
    raise exception 'INVALID_PERFORMANCE_DATE' using errcode = '22023';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'INVALID_PERFORMANCE_ENTRIES' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) x
    where jsonb_typeof(x) <> 'object' or nullif(x->>'profileId', '') is null
  ) then
    raise exception 'INVALID_PERFORMANCE_ENTRIES' using errcode = '22023';
  end if;

  v_registered_by := coalesce(p_registered_by, v_operator);

  for e in select * from jsonb_array_elements(p_entries)
  loop
    v_profile := (e->>'profileId')::uuid;
    delete from public.staff_performance_records
      where profile_id = v_profile and adjust_date = p_date and role_code = btrim(p_role_code);

    if jsonb_typeof(e->'items') = 'array' then
      for it in select * from jsonb_array_elements(e->'items')
      loop
        v_name := btrim(coalesce(it->>'name', ''));
        if v_name = '' or char_length(v_name) > 50 then
          raise exception 'INVALID_PERFORMANCE_NAME' using errcode = '22023';
        end if;
        if jsonb_typeof(it->'amountCents') is distinct from 'number'
           or trunc((it->>'amountCents')::numeric) <> (it->>'amountCents')::numeric then
          raise exception 'INVALID_PERFORMANCE_AMOUNT' using errcode = '22023';
        end if;
        v_amount := (it->>'amountCents')::bigint;
        if v_amount = 0 then
          raise exception 'INVALID_PERFORMANCE_AMOUNT' using errcode = '22023';
        end if;

        insert into public.staff_performance_records
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
revoke all on function public.set_staff_performance(text, date, jsonb, uuid) from public, anon;
grant execute on function public.set_staff_performance(text, date, jsonb, uuid) to authenticated;

-- ---------- 4. 人事主管可设置「人事」角色的基础薪资 ----------
create or replace function public.set_staff_base_income(p_profile_id uuid, p_role_code text, p_cents bigint)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role_id bigint;
begin
  if not (public.is_admin() or (public.is_hr_manager() and btrim(p_role_code) = 'hr')) then
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

notify pgrst, 'reload schema';
