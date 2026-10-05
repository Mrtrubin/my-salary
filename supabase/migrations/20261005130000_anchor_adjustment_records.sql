-- 主播「调整项」统一存储表：承载主持（收入口径）、化妆师、舞蹈老师设置的调整项。
--
-- 设计：
--   * 每行 = 某主播某天的一条命名调整项；amount_cents 有符号（正=增加，负=扣减）。
--   * source 区分来源角色：host / makeup / dance。化妆师与舞蹈老师的「延误」各自独立
--     （唯一键含 source，互不覆盖）。
--   * 本迁移先落地：表 + 舞蹈老师「练舞」（补助/延误）读写 RPC，并把历史舞蹈老师「奖励」
--     数据迁入；主持/化妆师链路的迁移在其后单独进行。

-- ---------- 1. 统一调整项表 ----------
create table if not exists public.anchor_adjustment_records (
  id uuid primary key default gen_random_uuid(),
  anchor_profile_id uuid not null references public.profiles(id) on delete cascade,
  adjust_date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -1000000000 and 1000000000),
  source text not null check (source in ('host', 'makeup', 'dance')),
  registered_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anchor_profile_id, adjust_date, name, source)
);
create index if not exists anchor_adjustment_records_date_idx
  on public.anchor_adjustment_records(adjust_date desc);
create index if not exists anchor_adjustment_records_anchor_idx
  on public.anchor_adjustment_records(anchor_profile_id);
create index if not exists anchor_adjustment_records_source_idx
  on public.anchor_adjustment_records(source, adjust_date desc);

-- ---------- 2. 迁移历史舞蹈老师「奖励」 → 统一表（source=dance） ----------
insert into public.anchor_adjustment_records
  (anchor_profile_id, adjust_date, name, amount_cents, source, registered_by, note, created_at, updated_at)
select anchor_profile_id, reward_date, name, amount_cents, 'dance', registered_by, note, created_at, updated_at
from public.anchor_reward_records
on conflict (anchor_profile_id, adjust_date, name, source) do nothing;

-- ---------- 3. 主播名单补充「当前生效基础薪资」（用于延误默认 保底/260） ----------
drop function if exists public.list_anchor_members();
create function public.list_anchor_members()
returns table(id uuid, name text, base_salary_cents bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, coalesce(s.base_salary_cents, 0)
  from public.profiles p
  join public.user_roles up on up.profile_id = p.id
  join public.roles pos on pos.id = up.role_id
  left join lateral public._anchor_effective_scheme(p.id, pos.id, current_date) s on true
  where pos.code = 'anchor'
    and p.status = 'active'
    and (public.is_admin() or public.is_makeup() or public.is_dance())
  order by p.name;
$$;
revoke all on function public.list_anchor_members() from public, anon;
grant execute on function public.list_anchor_members() to authenticated;

-- ---------- 4. 查询调整项（按 source / 日期区间过滤） ----------
create or replace function public.list_anchor_adjustments(
  p_source text default null,
  p_start date default null,
  p_end date default null
)
returns table(
  id uuid,
  anchor_profile_id uuid,
  anchor_name text,
  adjust_date date,
  name text,
  amount_cents bigint,
  source text,
  registered_by uuid,
  registered_name text,
  note text,
  updated_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select a.id, a.anchor_profile_id, p.name, a.adjust_date, a.name, a.amount_cents,
         a.source, a.registered_by, r.name, a.note, a.updated_at
  from public.anchor_adjustment_records a
  join public.profiles p on p.id = a.anchor_profile_id
  left join public.profiles r on r.id = a.registered_by
  where (public.is_admin() or public.is_dance() or public.is_makeup())
    and (p_source is null or a.source = p_source)
    and (p_start is null or a.adjust_date >= p_start)
    and (p_end is null or a.adjust_date <= p_end)
  order by a.adjust_date desc, p.name, a.name;
$$;
revoke all on function public.list_anchor_adjustments(text, date, date) from public, anon;
grant execute on function public.list_anchor_adjustments(text, date, date) to authenticated;

-- ---------- 5. 舞蹈老师批量设置当日补助 / 延误（source=dance） ----------
-- p_entries: [{ "anchorId": uuid, "items": [{ "name": "补助"|"延误", "amountCents": bigint, "note"?: text }] }]
-- 对每个 entry 覆盖该主播当日的舞蹈调整项；items 为空则清空（不落记录）。
create or replace function public.set_dance_adjustments(p_date date, p_entries jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  it jsonb;
  v_anchor uuid;
  v_name text;
  v_amount bigint;
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
        if v_name = '补助' and v_amount <= 0 then
          raise exception 'INVALID_ADJUSTMENT_AMOUNT' using errcode = '22023';
        end if;
        if v_name = '延误' and v_amount >= 0 then
          raise exception 'INVALID_ADJUSTMENT_AMOUNT' using errcode = '22023';
        end if;

        insert into public.anchor_adjustment_records
          (anchor_profile_id, adjust_date, name, amount_cents, source, registered_by, note, updated_at)
        values
          (v_anchor, p_date, v_name, v_amount, 'dance', v_operator,
           nullif(btrim(coalesce(it->>'note', '')), ''), v_now)
        on conflict (anchor_profile_id, adjust_date, name, source) do update
          set amount_cents = excluded.amount_cents,
              registered_by = excluded.registered_by,
              note = excluded.note,
              updated_at = v_now;
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_dance_adjustments(date, jsonb) from public, anon;
grant execute on function public.set_dance_adjustments(date, jsonb) to authenticated;

-- ---------- 6. RLS 与授权（写入仅经 security definer RPC） ----------
alter table public.anchor_adjustment_records enable row level security;
create policy anchor_adjustment_records_select on public.anchor_adjustment_records for select to authenticated
  using (public.is_admin() or public.is_dance() or public.is_makeup());
grant select on public.anchor_adjustment_records to authenticated;
grant all on public.anchor_adjustment_records to service_role;
revoke all on public.anchor_adjustment_records from anon;

notify pgrst, 'reload schema';
