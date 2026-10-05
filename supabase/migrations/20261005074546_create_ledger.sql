-- 收支明细模块：
--   1) ledger_tags  ：标签字典（管理员维护；系统标签带稳定 code，禁删禁改名）。
--   2) ledger_entries：收支流水。金额带符号——amount_cents >= 0 为收入，< 0 为支出。
--      - 手动记录：source_type='manual'，source_id 为空，created_by/created_by_type 由触发器写入当前管理员。
--      - 自动记录：工资条生成/重算/删除时由触发器同步，created_by_type='system'，展示为「系统生成」。
--   3) 工资条三表（salary_records / host_salary_records / staff_salary_records）触发器：
--      生成即记支出（金额 = -net_cents，负数工资自然转正=收入），重算同步金额（不覆盖已改的入账时间），
--      删除即删对应支出；找不到系统标签则整单结算报错回滚。
--   4) 删除「未完成工资条」RPC（status <> 'completed'，仅管理员）。
--   5) get_ledger_summary 聚合 RPC（本月/本年收入、支出、结余、按标签、按月趋势）。

-- ============================================================
-- 1. 标签字典
-- ============================================================
create table public.ledger_tags (
  id uuid primary key default gen_random_uuid(),
  -- 稳定标识：系统标签固定 code，触发器按 code 定位；自定义标签自动生成。
  code text not null unique default ('tag_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  -- 系统保留标签：不可删除、不可改名/改 code。
  is_system boolean not null default false,
  status public.employment_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ledger_tags (code, name, is_system) values
  ('salary_anchor', '主播工资', true),
  ('salary_host',   '主持工资', true),
  ('salary_staff',  '员工工资', true),
  ('other_income',  '其他收入', true),
  ('other_expense', '其他支出', true)
on conflict (code) do nothing;

-- 系统标签保护：禁止删除、禁止改名/改 code/is_system。
create or replace function public.guard_ledger_tag_system()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'LEDGER_TAG_SYSTEM_IMMUTABLE' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.is_system and (
       new.name is distinct from old.name
       or new.code is distinct from old.code
       or new.is_system is distinct from old.is_system
       or new.status is distinct from old.status
     ) then
    raise exception 'LEDGER_TAG_SYSTEM_IMMUTABLE' using errcode = '42501';
  end if;
  if new.is_system is distinct from old.is_system then
    raise exception 'LEDGER_TAG_SYSTEM_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger ledger_tags_guard
  before update or delete on public.ledger_tags
  for each row execute function public.guard_ledger_tag_system();

-- ============================================================
-- 2. 收支流水
-- ============================================================
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  -- 带符号金额（分）：>=0 收入，<0 支出。
  amount_cents bigint not null,
  tag_id uuid references public.ledger_tags(id) on delete set null,
  -- 业务发生时间（DB 存 UTC，前端显示本地，精确到秒，手动/自动均可改）。
  occurred_at timestamptz not null default now(),
  note text,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'anchor_salary', 'host_salary', 'staff_salary')),
  source_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_type text not null default 'user' check (created_by_type in ('system', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id),
  -- manual ⇒ source_id 为空；自动 ⇒ source_id 非空。
  constraint ledger_entries_source_check
    check ((source_type = 'manual' and source_id is null)
        or (source_type <> 'manual' and source_id is not null))
);

create index ledger_entries_occurred_at_idx on public.ledger_entries(occurred_at desc);
create index ledger_entries_tag_idx on public.ledger_entries(tag_id);

-- 写入创建者：手动记录记当前管理员（user），自动记录记 system。
create or replace function public.set_ledger_entry_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_type = 'manual' then
    new.created_by_type := 'user';
    new.created_by := public.current_profile_id();
  else
    new.created_by_type := 'system';
    new.created_by := null;
  end if;
  return new;
end $$;

create trigger ledger_entries_set_actor
  before insert on public.ledger_entries
  for each row execute function public.set_ledger_entry_actor();

-- 更新保护：手动记录可全量编辑（来源标识除外）；自动记录仅允许改 occurred_at（其余只读）。
-- 工资条同步触发器通过会话变量 app.ledger_sync 放行金额同步。
create or replace function public.guard_ledger_entry_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.ledger_sync', true), 'off') = 'on' then
    return new;
  end if;
  if new.source_type is distinct from old.source_type
     or new.source_id is distinct from old.source_id
     or new.created_by is distinct from old.created_by
     or new.created_by_type is distinct from old.created_by_type then
    raise exception 'LEDGER_SOURCE_IMMUTABLE' using errcode = '42501';
  end if;
  if old.source_type <> 'manual' and (
       new.amount_cents is distinct from old.amount_cents
       or new.tag_id is distinct from old.tag_id
       or new.note is distinct from old.note
     ) then
    raise exception 'LEDGER_AUTO_READONLY' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger ledger_entries_guard_update
  before update on public.ledger_entries
  for each row execute function public.guard_ledger_entry_update();

-- ============================================================
-- 3. 工资条联动触发器
-- ============================================================
create or replace function public.sync_salary_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text;
  v_code text;
  v_tag uuid;
  v_amount bigint;
  v_period_end date;
  v_occurred timestamptz;
begin
  if tg_table_name = 'salary_records' then
    v_source := 'anchor_salary'; v_code := 'salary_anchor';
  elsif tg_table_name = 'host_salary_records' then
    v_source := 'host_salary'; v_code := 'salary_host';
  elsif tg_table_name = 'staff_salary_records' then
    v_source := 'staff_salary'; v_code := 'salary_staff';
  else
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.ledger_entries
    where source_type = v_source and source_id = old.id;
    return old;
  end if;

  -- 支出为 -net_cents；负数工资 → 正数（收入）。
  v_amount := -new.net_cents;
  v_period_end := new.period_end;
  v_occurred := case
    when v_period_end is null then now()
    else (v_period_end::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'UTC'
  end;

  select id into v_tag from public.ledger_tags where code = v_code;
  if v_tag is null then
    raise exception 'LEDGER_TAG_MISSING' using errcode = 'P0002';
  end if;

  perform set_config('app.ledger_sync', 'on', true);
  insert into public.ledger_entries
    (amount_cents, tag_id, occurred_at, source_type, source_id, created_by_type)
  values
    (v_amount, v_tag, v_occurred, v_source, new.id, 'system')
  on conflict (source_type, source_id) do update
    set amount_cents = excluded.amount_cents,
        tag_id = excluded.tag_id,
        updated_at = now();
  perform set_config('app.ledger_sync', 'off', true);

  return new;
end $$;

create trigger salary_records_ledger_sync
  after insert or update of net_cents or delete on public.salary_records
  for each row execute function public.sync_salary_ledger();

create trigger host_salary_records_ledger_sync
  after insert or update of net_cents or delete on public.host_salary_records
  for each row execute function public.sync_salary_ledger();

create trigger staff_salary_records_ledger_sync
  after insert or update of net_cents or delete on public.staff_salary_records
  for each row execute function public.sync_salary_ledger();

-- ============================================================
-- 4. 删除「未完成工资条」RPC（status <> 'completed'，仅管理员，无额外状态日志）
-- ============================================================
create or replace function public.delete_salary_record(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status public.salary_record_status;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select status into v_status from public.salary_records where id = p_id for update;
  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'completed' then
    raise exception 'SALARY_RECORD_COMPLETED' using errcode = 'P0001';
  end if;
  delete from public.salary_records where id = p_id;
end $$;
revoke all on function public.delete_salary_record(uuid) from public, anon;
grant execute on function public.delete_salary_record(uuid) to authenticated;

create or replace function public.delete_host_salary_record(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status public.salary_record_status;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select status into v_status from public.host_salary_records where id = p_id for update;
  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'completed' then
    raise exception 'SALARY_RECORD_COMPLETED' using errcode = 'P0001';
  end if;
  delete from public.host_salary_records where id = p_id;
end $$;
revoke all on function public.delete_host_salary_record(uuid) from public, anon;
grant execute on function public.delete_host_salary_record(uuid) to authenticated;

create or replace function public.delete_staff_salary_record(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status public.salary_record_status;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select status into v_status from public.staff_salary_records where id = p_id for update;
  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'completed' then
    raise exception 'SALARY_RECORD_COMPLETED' using errcode = 'P0001';
  end if;
  delete from public.staff_salary_records where id = p_id;
end $$;
revoke all on function public.delete_staff_salary_record(uuid) from public, anon;
grant execute on function public.delete_staff_salary_record(uuid) to authenticated;

-- ============================================================
-- 5. 汇总 RPC（区间收入/支出/结余 + 按标签 + 按月）
-- ============================================================
create or replace function public.get_ledger_summary(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := (p_start::timestamp) at time zone 'UTC';
  v_end timestamptz := ((p_end::timestamp) + interval '1 day' - interval '1 second') at time zone 'UTC';
  v_income bigint;
  v_expense bigint;
  v_net bigint;
  v_by_tag jsonb;
  v_by_month jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select
    coalesce(sum(case when amount_cents >= 0 then amount_cents else 0 end), 0)::bigint,
    coalesce(sum(case when amount_cents < 0 then -amount_cents else 0 end), 0)::bigint,
    coalesce(sum(amount_cents), 0)::bigint
  into v_income, v_expense, v_net
  from public.ledger_entries
  where occurred_at between v_start and v_end;

  select coalesce(jsonb_agg(t order by t.amount_cents), '[]'::jsonb) into v_by_tag
  from (
    select e.tag_id as "tagId",
           coalesce(tag.name, '未分类') as "tagName",
           count(*)::int as "count",
           coalesce(sum(e.amount_cents), 0)::bigint as amount_cents
    from public.ledger_entries e
    left join public.ledger_tags tag on tag.id = e.tag_id
    where e.occurred_at between v_start and v_end
    group by e.tag_id, tag.name
  ) t;

  select coalesce(jsonb_agg(m order by m."month"), '[]'::jsonb) into v_by_month
  from (
    select to_char(date_trunc('month', e.occurred_at at time zone 'UTC'), 'YYYY-MM') as "month",
           coalesce(sum(case when e.amount_cents >= 0 then e.amount_cents else 0 end), 0)::bigint as "incomeCents",
           coalesce(sum(case when e.amount_cents < 0 then -e.amount_cents else 0 end), 0)::bigint as "expenseCents",
           coalesce(sum(e.amount_cents), 0)::bigint as "netCents"
    from public.ledger_entries e
    where e.occurred_at between v_start and v_end
    group by 1
  ) m;

  return jsonb_build_object(
    'incomeCents', v_income,
    'expenseCents', v_expense,
    'netCents', v_net,
    'byTag', v_by_tag,
    'byMonth', v_by_month
  );
end $$;
revoke all on function public.get_ledger_summary(date, date) from public, anon;
grant execute on function public.get_ledger_summary(date, date) to authenticated;

-- ============================================================
-- 6. RLS 与授权
-- ============================================================
alter table public.ledger_tags enable row level security;

create policy ledger_tags_select on public.ledger_tags for select to authenticated
  using (public.is_admin());
create policy ledger_tags_insert on public.ledger_tags for insert to authenticated
  with check (public.is_admin());
create policy ledger_tags_update on public.ledger_tags for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ledger_tags_delete on public.ledger_tags for delete to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.ledger_tags to authenticated;
grant all on public.ledger_tags to service_role;
revoke all on public.ledger_tags from anon;

alter table public.ledger_entries enable row level security;

create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (public.is_admin());
create policy ledger_entries_insert on public.ledger_entries for insert to authenticated
  with check (public.is_admin());
create policy ledger_entries_update on public.ledger_entries for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ledger_entries_delete on public.ledger_entries for delete to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.ledger_entries to authenticated;
grant all on public.ledger_entries to service_role;
revoke all on public.ledger_entries from anon;
