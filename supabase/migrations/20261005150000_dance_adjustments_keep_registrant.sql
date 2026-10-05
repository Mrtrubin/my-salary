-- 练舞编辑保留「提交人」：set_dance_adjustments 增加 p_registered_by（缺省为当前操作人）。
-- 否则编辑他人卡片会把 registered_by 改成当前用户，导致卡片在「提交人」维度漂移。

drop function if exists public.set_dance_adjustments(date, jsonb);

create function public.set_dance_adjustments(
  p_date date,
  p_entries jsonb,
  p_registered_by uuid default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  it jsonb;
  v_anchor uuid;
  v_name text;
  v_amount bigint;
  v_registered_by uuid;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if public.is_dance() is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_date is null or not isfinite(p_date) then
    raise exception 'INVALID_ADJUSTMENT_DATE' using errcode = '22023';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'INVALID_ADJUSTMENT_ENTRIES' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) x
    where jsonb_typeof(x) <> 'object' or nullif(x->>'anchorId', '') is null
  ) then
    raise exception 'INVALID_ADJUSTMENT_ENTRIES' using errcode = '22023';
  end if;

  v_registered_by := coalesce(p_registered_by, v_operator);

  for e in select * from jsonb_array_elements(p_entries)
  loop
    v_anchor := (e->>'anchorId')::uuid;
    delete from public.anchor_adjustment_records
      where anchor_profile_id = v_anchor and adjust_date = p_date and source = 'dance';

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

        insert into public.anchor_adjustment_records
          (anchor_profile_id, adjust_date, name, amount_cents, source, registered_by, note, updated_at)
        values
          (v_anchor, p_date, v_name, v_amount, 'dance', v_registered_by,
           nullif(btrim(coalesce(it->>'note', '')), ''), v_now);
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_dance_adjustments(date, jsonb, uuid) from public, anon;
grant execute on function public.set_dance_adjustments(date, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
