-- 化妆师收益管理 + 主播延误记录。
--
-- A. 化妆师收益（独立于主播/主持工资）：
--    * 基础收益来自 profiles.makeup_base_income_cents（每人一个当前值，不版本化）。
--    * 总违约 / 总奖励由管理员在「工资核算-化妆师-新增记录」时手工填写（与延误无关）。
--    * 调整合计 = 总违约 + 总奖励；实发收益 = 基础收益 + 调整合计；到手收益 = 实发收益（无服务费）。
--    * 复用 salary_record_status 四态枚举；独立表 makeup_salary_records。
--
-- B. 主播延误记录（化妆师登记）：
--    * 每个主播每天最多一条，唯一键 (anchor_profile_id, delay_date)。
--    * is_delayed 记录延误/非延误（只要设置过就落库）；registered_by 为最近修改的化妆师（后改覆盖）。
--    * 所有化妆师共享可见；延误用于结算主播工资时预填「延误」调整项（前端按条数折算，保底/260）。

-- ---------- 1. 化妆师基础收益（当前值） ----------
alter table public.profiles
  add column if not exists makeup_base_income_cents bigint not null default 0
  check (makeup_base_income_cents >= 0);

-- ---------- 2. 化妆师收益记录 ----------
create table public.makeup_salary_records (
  id uuid primary key default gen_random_uuid(),
  makeup_profile_id uuid not null references public.profiles(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  period_start date not null,
  period_end date not null,
  -- 基础收益快照（分）。
  base_income_cents bigint not null default 0 check (base_income_cents >= 0),
  -- 总违约（分，负数）。
  penalty_cents bigint not null default 0 check (penalty_cents <= 0),
  -- 总奖励（分，正数）。
  reward_cents bigint not null default 0 check (reward_cents >= 0),
  -- 调整合计 = penalty + reward。
  adjustment_cents bigint not null,
  -- 实发收益 = base_income + adjustment。
  gross_cents bigint not null,
  -- 到手收益 = gross（化妆品类无服务费）。
  net_cents bigint not null,
  status public.salary_record_status not null default 'pending_review',
  review_pending_at timestamptz,
  confirm_pending_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (makeup_profile_id, period_start, period_end)
);
create index makeup_salary_records_period_idx
  on public.makeup_salary_records(period_start desc, period_end desc);
create index makeup_salary_records_makeup_idx
  on public.makeup_salary_records(makeup_profile_id);

-- ---------- 3. 化妆师收益状态日志 ----------
create table public.makeup_salary_record_status_logs (
  id uuid primary key default gen_random_uuid(),
  salary_record_id uuid not null references public.makeup_salary_records(id) on delete cascade,
  from_status public.salary_record_status,
  to_status public.salary_record_status not null,
  operator_profile_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index makeup_salary_record_status_logs_record_idx
  on public.makeup_salary_record_status_logs(salary_record_id, created_at);

-- ---------- 4. 主播延误记录 ----------
create table public.anchor_delay_records (
  id uuid primary key default gen_random_uuid(),
  anchor_profile_id uuid not null references public.profiles(id) on delete cascade,
  delay_date date not null,
  is_delayed boolean not null default true,
  registered_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anchor_profile_id, delay_date)
);
create index anchor_delay_records_date_idx on public.anchor_delay_records(delay_date desc);
create index anchor_delay_records_anchor_idx on public.anchor_delay_records(anchor_profile_id);

-- ---------- 5. 角色判定：化妆师 ----------
create or replace function public.is_makeup()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_positions up
    join public.positions p on p.id = up.position_id
    where up.profile_id = public.current_profile_id() and p.code = 'makeup'
  );
$$;
revoke all on function public.is_makeup() from public, anon;
grant execute on function public.is_makeup() to authenticated;

-- ---------- 6. 主播名单（供化妆师标记延误时多选） ----------
create or replace function public.list_anchor_members()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select p.id, p.name
  from public.profiles p
  join public.user_positions up on up.profile_id = p.id
  join public.positions pos on pos.id = up.position_id
  where pos.code = 'anchor'
    and p.status = 'active'
    and (public.is_admin() or public.is_makeup())
  order by p.name;
$$;
revoke all on function public.list_anchor_members() from public, anon;
grant execute on function public.list_anchor_members() to authenticated;

-- ---------- 7. 延误记录查询（含主播名 / 登记化妆师名） ----------
create or replace function public.list_anchor_delays(p_start date default null, p_end date default null)
returns table(
  id uuid,
  anchor_profile_id uuid,
  anchor_name text,
  delay_date date,
  is_delayed boolean,
  registered_by uuid,
  registered_name text,
  note text,
  updated_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select d.id, d.anchor_profile_id, a.name, d.delay_date, d.is_delayed,
         d.registered_by, r.name, d.note, d.updated_at
  from public.anchor_delay_records d
  join public.profiles a on a.id = d.anchor_profile_id
  left join public.profiles r on r.id = d.registered_by
  where (public.is_admin() or public.is_makeup())
    and (p_start is null or d.delay_date >= p_start)
    and (p_end is null or d.delay_date <= p_end)
  order by d.delay_date desc, a.name;
$$;
revoke all on function public.list_anchor_delays(date, date) from public, anon;
grant execute on function public.list_anchor_delays(date, date) to authenticated;

-- ---------- 8. 设置延误（批量 upsert，后改覆盖登记人） ----------
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
  if not (public.is_admin() or public.is_makeup()) then
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

-- ---------- 9. 新增/覆盖化妆师收益记录（管理员手填总违约/总奖励） ----------
-- p_records 每项：{ makeupProfileId, penaltyCents?, rewardCents?, note? }
create or replace function public.create_makeup_salary_records(
  p_period_start date,
  p_period_end date,
  p_records jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  v_makeup_id uuid;
  v_base bigint;
  v_penalty bigint;
  v_reward bigint;
  v_adjust bigint;
  v_gross bigint;
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
    where jsonb_typeof(x) <> 'object' or nullif(x->>'makeupProfileId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_RECORDS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    group by x->>'makeupProfileId' having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_MEMBER' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) x
    where (x ? 'penaltyCents' and jsonb_typeof(x->'penaltyCents') <> 'number')
       or (x ? 'rewardCents' and jsonb_typeof(x->'rewardCents') <> 'number')
  ) then
    raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_records)
  loop
    v_makeup_id := (m->>'makeupProfileId')::uuid;

    select makeup_base_income_cents into v_base
    from public.profiles where id = v_makeup_id;
    if not found then
      raise exception 'MAKEUP_PROFILE_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_penalty := coalesce((m->>'penaltyCents')::bigint, 0);
    v_reward := coalesce((m->>'rewardCents')::bigint, 0);
    if v_penalty > 0 or v_reward < 0 then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;
    v_adjust := v_penalty + v_reward;
    v_gross := v_base + v_adjust;

    select id, status into v_record_id, v_status from public.makeup_salary_records
    where makeup_profile_id = v_makeup_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted and v_status <> 'pending_review'::public.salary_record_status then
      raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
    end if;

    if v_inserted then
      insert into public.makeup_salary_records (
        makeup_profile_id, month, period_start, period_end,
        base_income_cents, penalty_cents, reward_cents, adjustment_cents,
        gross_cents, net_cents, status, review_pending_at, note
      ) values (
        v_makeup_id, date_trunc('month', p_period_start)::date, p_period_start, p_period_end,
        v_base, v_penalty, v_reward, v_adjust,
        v_gross, v_gross, 'pending_review'::public.salary_record_status, v_now,
        nullif(trim(coalesce(m->>'note', '')), '')
      ) returning id into v_record_id;
    else
      update public.makeup_salary_records set
        base_income_cents = v_base,
        penalty_cents = v_penalty,
        reward_cents = v_reward,
        adjustment_cents = v_adjust,
        gross_cents = v_gross,
        net_cents = v_gross,
        status = 'pending_review'::public.salary_record_status,
        review_pending_at = v_now,
        note = nullif(trim(coalesce(m->>'note', '')), ''),
        updated_at = v_now
      where id = v_record_id;
    end if;

    insert into public.makeup_salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when v_inserted then '管理员新增化妆师收益记录'
           else '管理员覆盖重算化妆师收益记录' end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.create_makeup_salary_records(date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.create_makeup_salary_records(date, date, jsonb)
  to authenticated;

-- ---------- 10. 驳回重算 RPC（金额不变，仅重置为待审核并重算合计） ----------
create or replace function public.recompute_makeup_salary_record(
  p_id uuid,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.makeup_salary_records%rowtype;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_gross bigint;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;
  select * into rec from public.makeup_salary_records where id = p_id for update;
  if not found then
    raise exception 'MAKEUP_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if rec.status <> 'pending_review'::public.salary_record_status then
    raise exception 'INVALID_TRANSITION:%->pending_review', rec.status using errcode = '22023';
  end if;
  v_gross := rec.base_income_cents + rec.penalty_cents + rec.reward_cents;
  update public.makeup_salary_records set
    adjustment_cents = rec.penalty_cents + rec.reward_cents,
    gross_cents = v_gross,
    net_cents = v_gross,
    status = 'pending_review'::public.salary_record_status,
    review_pending_at = v_now,
    updated_at = v_now
  where id = p_id;
  insert into public.makeup_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review'::public.salary_record_status,
          'pending_review'::public.salary_record_status, v_operator,
          coalesce(p_note, '管理员驳回，已重新计算化妆师收益'));
end $$;
revoke all on function public.recompute_makeup_salary_record(uuid, text)
  from public, anon, service_role;
grant execute on function public.recompute_makeup_salary_record(uuid, text)
  to authenticated;

-- ---------- 11. 状态流转 RPC（四态） ----------
create or replace function public.transition_makeup_salary_status(
  p_id uuid,
  p_to_status public.salary_record_status,
  p_operator_profile_id uuid default null,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_from public.salary_record_status;
  v_makeup_id uuid;
  v_is_admin boolean := public.is_admin();
  v_caller uuid := public.current_profile_id();
  v_operator uuid;
  v_now timestamptz := now();
begin
  select status, makeup_profile_id into v_from, v_makeup_id
  from public.makeup_salary_records where id = p_id for update;
  if not found then
    raise exception 'MAKEUP_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if v_makeup_id is distinct from v_caller
       or v_from <> 'pending_confirm'
       or p_to_status <> 'confirmed' then
      raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  v_operator := case when v_is_admin then coalesce(p_operator_profile_id, v_caller) else v_caller end;

  if not (
       (v_from = 'pending_review'  and p_to_status = 'pending_confirm')
    or (v_from = 'pending_confirm' and p_to_status = 'confirmed')
    or (v_from = 'confirmed'       and p_to_status = 'completed')
  ) then
    raise exception 'INVALID_TRANSITION:%->%', v_from, p_to_status
      using errcode = '22023';
  end if;

  update public.makeup_salary_records
  set status = p_to_status,
      updated_at = v_now,
      confirm_pending_at = case when p_to_status = 'pending_confirm' then v_now else confirm_pending_at end,
      confirmed_at       = case when p_to_status = 'confirmed'       then v_now else confirmed_at end,
      completed_at       = case when p_to_status = 'completed'       then v_now else completed_at end,
      reviewed_by  = case when p_to_status = 'pending_confirm' and v_operator is not null then v_operator else reviewed_by end,
      confirmed_by = case when p_to_status = 'confirmed'       and v_operator is not null then v_operator else confirmed_by end,
      completed_by = case when p_to_status = 'completed'       and v_operator is not null then v_operator else completed_by end
  where id = p_id and status = v_from;

  insert into public.makeup_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, v_from, p_to_status, v_operator, p_note);

  if p_to_status = 'pending_confirm' then
    insert into public.notifications (profile_id, type, title, body, ref_id)
    values (v_makeup_id, 'payslip_pending', '工资条待确认', '您有一份新的工资条待确认，请及时查看。', p_id);
  end if;
end $$;
revoke all on function public.transition_makeup_salary_status(uuid, public.salary_record_status, uuid, text)
  from public, anon, service_role;
grant execute on function public.transition_makeup_salary_status(uuid, public.salary_record_status, uuid, text)
  to authenticated;

-- ---------- 12. RLS ----------
alter table public.makeup_salary_records enable row level security;
alter table public.makeup_salary_record_status_logs enable row level security;
alter table public.anchor_delay_records enable row level security;

create policy makeup_salary_records_select on public.makeup_salary_records for select to authenticated
  using (
    public.is_admin()
    or (makeup_profile_id = public.current_profile_id() and status <> 'pending_review')
  );
create policy makeup_salary_records_insert on public.makeup_salary_records for insert to authenticated
  with check (public.is_admin());
create policy makeup_salary_records_update on public.makeup_salary_records for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy makeup_salary_records_member_confirm on public.makeup_salary_records for update to authenticated
  using (makeup_profile_id = public.current_profile_id() and status = 'pending_confirm')
  with check (makeup_profile_id = public.current_profile_id() and status = 'confirmed');

-- 非管理员更新时，除 status / 确认相关列外其余列必须保持不变。
create or replace function public.guard_makeup_salary_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.makeup_profile_id is distinct from old.makeup_profile_id
     or new.month is distinct from old.month
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.base_income_cents is distinct from old.base_income_cents
     or new.penalty_cents is distinct from old.penalty_cents
     or new.reward_cents is distinct from old.reward_cents
     or new.adjustment_cents is distinct from old.adjustment_cents
     or new.gross_cents is distinct from old.gross_cents
     or new.net_cents is distinct from old.net_cents
  then
    raise exception '成员确认工资时不允许修改金额或结算相关字段';
  end if;
  return new;
end $$;

create trigger makeup_salary_records_member_update_guard
  before update on public.makeup_salary_records
  for each row execute function public.guard_makeup_salary_member_update();

create policy makeup_salary_logs_select on public.makeup_salary_record_status_logs for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.makeup_salary_records r
      where r.id = makeup_salary_record_status_logs.salary_record_id
        and r.makeup_profile_id = public.current_profile_id()
    )
  );
create policy makeup_salary_logs_insert on public.makeup_salary_record_status_logs for insert to authenticated
  with check (public.is_admin());

create policy anchor_delay_records_select on public.anchor_delay_records for select to authenticated
  using (public.is_admin() or public.is_makeup());
create policy anchor_delay_records_insert on public.anchor_delay_records for insert to authenticated
  with check (public.is_admin() or public.is_makeup());
create policy anchor_delay_records_update on public.anchor_delay_records for update to authenticated
  using (public.is_admin() or public.is_makeup())
  with check (public.is_admin() or public.is_makeup());
create policy anchor_delay_records_delete on public.anchor_delay_records for delete to authenticated
  using (public.is_admin() or public.is_makeup());

-- ---------- 13. 授权 ----------
grant select, insert, update on public.makeup_salary_records to authenticated;
grant select, insert on public.makeup_salary_record_status_logs to authenticated;
grant select, insert, update, delete on public.anchor_delay_records to authenticated;
grant all on public.makeup_salary_records to service_role;
grant all on public.makeup_salary_record_status_logs to service_role;
grant all on public.anchor_delay_records to service_role;
revoke all on public.makeup_salary_records from anon;
revoke all on public.makeup_salary_record_status_logs from anon;
revoke all on public.anchor_delay_records from anon;
