-- 延误记录支持备注（可为空）。
-- set_anchor_delays 增加 p_note 参数并写入/覆盖 anchor_delay_records.note。

drop function if exists public.set_anchor_delays(date, uuid[], boolean);

create or replace function public.set_anchor_delays(
  p_delay_date date,
  p_anchor_ids uuid[],
  p_is_delayed boolean,
  p_note text default null
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
      (anchor_profile_id, delay_date, is_delayed, note, registered_by, updated_at)
    values (v_id, p_delay_date, coalesce(p_is_delayed, true), nullif(trim(p_note), ''), v_operator, v_now)
    on conflict (anchor_profile_id, delay_date) do update
      set is_delayed = excluded.is_delayed,
          note = excluded.note,
          registered_by = excluded.registered_by,
          updated_at = v_now;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_anchor_delays(date, uuid[], boolean, text)
  from public, anon;
grant execute on function public.set_anchor_delays(date, uuid[], boolean, text)
  to authenticated;
