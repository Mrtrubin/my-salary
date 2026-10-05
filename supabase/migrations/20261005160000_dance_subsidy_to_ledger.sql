-- 练舞「补助」（正数调整项）不进主播工资，直接计入系统支出（收支明细）；
-- 「延误」（负数调整项）仍作为工资条调整项，不单独记收支。
--
-- 实现：在 anchor_adjustment_records 上挂触发器，把 source='dance' 且 amount_cents>0 的
-- 调整项同步为 ledger_entries 支出（金额取负），金额/删除随调整项联动。

-- ---------- 1. 新增系统标签「练舞补助」 ----------
insert into public.ledger_tags (code, name, is_system)
values ('dance_subsidy', '练舞补助', true)
on conflict (code) do nothing;

-- ---------- 2. 扩展 ledger_entries.source_type 允许 'dance_subsidy' ----------
alter table public.ledger_entries drop constraint if exists ledger_entries_source_type_check;
alter table public.ledger_entries add constraint ledger_entries_source_type_check
  check (source_type = any (array['manual', 'anchor_salary', 'host_salary', 'staff_salary', 'dance_subsidy']));

-- ---------- 3. 练舞补助 → 收支支出 同步触发器函数 ----------
create or replace function public.sync_dance_subsidy_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tag uuid;
  v_anchor_name text;
  v_occurred timestamptz;
begin
  if tg_op = 'DELETE' then
    if old.source = 'dance' and old.amount_cents > 0 then
      delete from public.ledger_entries
      where source_type = 'dance_subsidy' and source_id = old.id;
    end if;
    return old;
  end if;

  if new.source = 'dance' and new.amount_cents > 0 then
    select id into v_tag from public.ledger_tags where code = 'dance_subsidy';
    if v_tag is null then
      raise exception 'LEDGER_TAG_MISSING' using errcode = 'P0002';
    end if;
    select name into v_anchor_name from public.profiles where id = new.anchor_profile_id;
    v_occurred := (new.adjust_date::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'UTC';

    perform set_config('app.ledger_sync', 'on', true);
    insert into public.ledger_entries
      (amount_cents, tag_id, occurred_at, note, source_type, source_id, created_by_type)
    values
      (-new.amount_cents, v_tag, v_occurred,
       '练舞' || new.name || '·' || coalesce(v_anchor_name, ''), 'dance_subsidy', new.id, 'system')
    on conflict (source_type, source_id) do update
      set amount_cents = excluded.amount_cents,
          tag_id = excluded.tag_id,
          occurred_at = excluded.occurred_at,
          note = excluded.note,
          updated_at = now();
    perform set_config('app.ledger_sync', 'off', true);
  else
    -- 变为非正数（或非 dance）：移除对应支出。
    delete from public.ledger_entries
    where source_type = 'dance_subsidy' and source_id = new.id;
  end if;
  return new;
end $$;

create trigger anchor_adjustment_records_ledger_sync
  after insert or update or delete on public.anchor_adjustment_records
  for each row execute function public.sync_dance_subsidy_ledger();

-- ---------- 4. 把已有练舞正数调整项回填为支出 ----------
insert into public.ledger_entries
  (amount_cents, tag_id, occurred_at, note, source_type, source_id, created_by_type)
select -a.amount_cents,
       (select id from public.ledger_tags where code = 'dance_subsidy'),
       (a.adjust_date::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'UTC',
       '练舞' || a.name || '·' || coalesce(p.name, ''),
       'dance_subsidy', a.id, 'system'
from public.anchor_adjustment_records a
left join public.profiles p on p.id = a.anchor_profile_id
where a.source = 'dance' and a.amount_cents > 0
on conflict (source_type, source_id) do nothing;

notify pgrst, 'reload schema';
