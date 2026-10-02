-- 舞蹈老师主播奖励项：按 (主播, 日期, 名称) 记录奖励金额，供主播流水结算自动填充调整项。
--
-- 复用化妆师「延误」链路：角色判定 is_dance()、登记留痕 registered_by、
-- 管理员只读（写入仅舞蹈老师，保证登记人真实）。

-- ---------- 1. 角色判定：舞蹈老师 ----------
create or replace function public.is_dance()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_positions up
    join public.positions p on p.id = up.position_id
    where up.profile_id = public.current_profile_id() and p.code = 'dance'
  );
$$;
revoke all on function public.is_dance() from public, anon;
grant execute on function public.is_dance() to authenticated;

-- ---------- 2. 奖励记录表 ----------
create table public.anchor_reward_records (
  id uuid primary key default gen_random_uuid(),
  anchor_profile_id uuid not null references public.profiles(id) on delete cascade,
  reward_date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  registered_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anchor_profile_id, reward_date, name)
);
create index anchor_reward_records_date_idx on public.anchor_reward_records(reward_date desc);
create index anchor_reward_records_anchor_idx on public.anchor_reward_records(anchor_profile_id);

-- ---------- 3. 主播名单权限放宽到舞蹈老师 ----------
create or replace function public.list_anchor_members()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select p.id, p.name
  from public.profiles p
  join public.user_positions up on up.profile_id = p.id
  join public.positions pos on pos.id = up.position_id
  where pos.code = 'anchor'
    and p.status = 'active'
    and (public.is_admin() or public.is_makeup() or public.is_dance())
  order by p.name;
$$;
revoke all on function public.list_anchor_members() from public, anon;
grant execute on function public.list_anchor_members() to authenticated;

-- ---------- 4. 奖励记录查询（含主播名 / 登记舞蹈老师名） ----------
create or replace function public.list_anchor_rewards(p_start date default null, p_end date default null)
returns table(
  id uuid,
  anchor_profile_id uuid,
  anchor_name text,
  reward_date date,
  name text,
  amount_cents bigint,
  registered_by uuid,
  registered_name text,
  note text,
  updated_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select r.id, r.anchor_profile_id, a.name, r.reward_date, r.name, r.amount_cents,
         r.registered_by, reg.name, r.note, r.updated_at
  from public.anchor_reward_records r
  join public.profiles a on a.id = r.anchor_profile_id
  left join public.profiles reg on reg.id = r.registered_by
  where (public.is_admin() or public.is_dance())
    and (p_start is null or r.reward_date >= p_start)
    and (p_end is null or r.reward_date <= p_end)
  order by r.reward_date desc, a.name;
$$;
revoke all on function public.list_anchor_rewards(date, date) from public, anon;
grant execute on function public.list_anchor_rewards(date, date) to authenticated;

-- ---------- 5. 批量设置奖励（唯一键 upsert，后改覆盖登记人/备注/金额） ----------
create or replace function public.set_anchor_rewards(
  p_reward_date date,
  p_anchor_ids uuid[],
  p_name text,
  p_amount_cents bigint,
  p_note text default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_id uuid;
  v_count integer := 0;
begin
  if public.is_dance() is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_reward_date is null or not isfinite(p_reward_date) then
    raise exception 'INVALID_REWARD_DATE' using errcode = '22023';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 50 then
    raise exception 'INVALID_REWARD_NAME' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    raise exception 'INVALID_REWARD_AMOUNT' using errcode = '22023';
  end if;
  if p_anchor_ids is null or array_length(p_anchor_ids, 1) is null then
    return 0;
  end if;
  foreach v_id in array p_anchor_ids loop
    insert into public.anchor_reward_records
      (anchor_profile_id, reward_date, name, amount_cents, registered_by, note, updated_at)
    values (v_id, p_reward_date, btrim(p_name), p_amount_cents, v_operator,
            nullif(btrim(coalesce(p_note, '')), ''), v_now)
    on conflict (anchor_profile_id, reward_date, name) do update
      set amount_cents = excluded.amount_cents,
          registered_by = excluded.registered_by,
          note = excluded.note,
          updated_at = v_now;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_anchor_rewards(date, uuid[], text, bigint, text) from public, anon;
grant execute on function public.set_anchor_rewards(date, uuid[], text, bigint, text) to authenticated;

-- ---------- 6. 编辑单条奖励（名称可改，命中唯一键报冲突） ----------
create or replace function public.update_anchor_reward(
  p_id uuid,
  p_name text,
  p_amount_cents bigint,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
begin
  if public.is_dance() is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 50 then
    raise exception 'INVALID_REWARD_NAME' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    raise exception 'INVALID_REWARD_AMOUNT' using errcode = '22023';
  end if;
  update public.anchor_reward_records
    set name = btrim(p_name),
        amount_cents = p_amount_cents,
        note = nullif(btrim(coalesce(p_note, '')), ''),
        updated_at = v_now
  where id = p_id;
  if not found then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'P0002';
  end if;
exception when unique_violation then
  raise exception 'REWARD_NAME_CONFLICT' using errcode = '23505';
end $$;
revoke all on function public.update_anchor_reward(uuid, text, bigint, text) from public, anon;
grant execute on function public.update_anchor_reward(uuid, text, bigint, text) to authenticated;

-- ---------- 7. 删除单条奖励 ----------
create or replace function public.delete_anchor_reward(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_dance() is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.anchor_reward_records where id = p_id;
  if not found then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.delete_anchor_reward(uuid) from public, anon;
grant execute on function public.delete_anchor_reward(uuid) to authenticated;

-- ---------- 8. RLS 与授权 ----------
alter table public.anchor_reward_records enable row level security;

create policy anchor_reward_records_select on public.anchor_reward_records for select to authenticated
  using (public.is_admin() or public.is_dance());
create policy anchor_reward_records_insert on public.anchor_reward_records for insert to authenticated
  with check (public.is_dance());
create policy anchor_reward_records_update on public.anchor_reward_records for update to authenticated
  using (public.is_dance()) with check (public.is_dance());
create policy anchor_reward_records_delete on public.anchor_reward_records for delete to authenticated
  using (public.is_dance());

grant select, insert, update, delete on public.anchor_reward_records to authenticated;
grant all on public.anchor_reward_records to service_role;
revoke all on public.anchor_reward_records from anon;
