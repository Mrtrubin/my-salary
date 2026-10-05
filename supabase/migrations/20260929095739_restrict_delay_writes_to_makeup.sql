-- 延误记录写入权限收紧：仅化妆师本人可增/改/删；管理员只读（用于主播流水结算预填）。
-- 背景（已与产品确认）：登记的化妆师名必须真实，管理员若可修改会导致登记人错误。
-- 同时收紧触发函数执行权限（触发器无需 EXECUTE 授权）。

-- 1. set_anchor_delays 仅允许化妆师调用。
create or replace function public.set_anchor_delays(
  p_delay_date date,
  p_anchor_ids uuid[],
  p_is_delayed boolean
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_id uuid;
  v_count integer := 0;
begin
  if public.is_makeup() is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_delay_date is null or not isfinite(p_delay_date) then
    raise exception 'INVALID_DELAY_DATE' using errcode = '22023';
  end if;
  if p_anchor_ids is null or array_length(p_anchor_ids, 1) is null then
    return 0;
  end if;
  foreach v_id in array p_anchor_ids loop
    insert into public.anchor_delay_records
      (anchor_profile_id, delay_date, is_delayed, registered_by, updated_at)
    values (v_id, p_delay_date, coalesce(p_is_delayed, true), v_operator, v_now)
    on conflict (anchor_profile_id, delay_date) do update
      set is_delayed = excluded.is_delayed,
          registered_by = excluded.registered_by,
          updated_at = v_now;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_anchor_delays(date, uuid[], boolean) from public, anon;
grant execute on function public.set_anchor_delays(date, uuid[], boolean) to authenticated;

-- 2. 写入策略仅放行化妆师（读策略仍为 管理员 or 化妆师，用于结算预填）。
drop policy if exists anchor_delay_records_insert on public.anchor_delay_records;
drop policy if exists anchor_delay_records_update on public.anchor_delay_records;
drop policy if exists anchor_delay_records_delete on public.anchor_delay_records;

create policy anchor_delay_records_insert on public.anchor_delay_records for insert to authenticated
  with check (public.is_makeup());
create policy anchor_delay_records_update on public.anchor_delay_records for update to authenticated
  using (public.is_makeup()) with check (public.is_makeup());
create policy anchor_delay_records_delete on public.anchor_delay_records for delete to authenticated
  using (public.is_makeup());

-- 3. 触发函数无需被调用方执行。
revoke all on function public.guard_makeup_salary_member_update() from public, anon, authenticated;
