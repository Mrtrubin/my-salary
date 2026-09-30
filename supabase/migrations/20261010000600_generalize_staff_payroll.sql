-- 泛化「固定薪资 + 调整项」工资条：化妆师 / 舞蹈老师 / 行政 / 运镜 / 人事 共用。
--
-- 与化妆师口径一致：实发收益 = 基础薪资 + 调整合计（总违约 + 总奖励）；
-- 个税按累计预扣（apply_income_tax）；到手 = 实发 − 个税。
-- 基础薪资按「职位」存在 profiles 的对应列（每人一个当前值）；通用表带 position_id。

-- ---------- 1. 新增职位 ----------
insert into public.positions (code, name, default_permissions) values
  ('executive', '行政', array['self.payslip.read']),
  ('camera', '运镜', array['self.payslip.read']),
  ('hr', '人事', array['self.payslip.read'])
on conflict (code) do nothing;

-- ---------- 2. 各职位基础薪资列 ----------
alter table public.profiles
  add column if not exists dance_base_income_cents bigint not null default 0 check (dance_base_income_cents >= 0),
  add column if not exists executive_base_income_cents bigint not null default 0 check (executive_base_income_cents >= 0),
  add column if not exists camera_base_income_cents bigint not null default 0 check (camera_base_income_cents >= 0),
  add column if not exists hr_base_income_cents bigint not null default 0 check (hr_base_income_cents >= 0);

-- ---------- 3. 通用固定薪资表 ----------
create table public.staff_salary_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  position_id bigint not null references public.positions(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  period_start date not null,
  period_end date not null,
  base_income_cents bigint not null default 0 check (base_income_cents >= 0),
  penalty_cents bigint not null default 0 check (penalty_cents <= 0),
  reward_cents bigint not null default 0 check (reward_cents >= 0),
  adjustment_cents bigint not null,
  gross_cents bigint not null,
  tax_cents bigint not null default 0 check (tax_cents >= 0),
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
  unique (profile_id, position_id, period_start, period_end)
);
create index staff_salary_records_period_idx on public.staff_salary_records(period_start desc, period_end desc);
create index staff_salary_records_profile_idx on public.staff_salary_records(profile_id, position_id);

create table public.staff_salary_record_status_logs (
  id uuid primary key default gen_random_uuid(),
  salary_record_id uuid not null references public.staff_salary_records(id) on delete cascade,
  from_status public.salary_record_status,
  to_status public.salary_record_status not null,
  operator_profile_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index staff_salary_record_status_logs_record_idx
  on public.staff_salary_record_status_logs(salary_record_id, created_at);

-- ---------- 4. 迁移既有化妆师记录 ----------
insert into public.staff_salary_records (
  id, profile_id, position_id, month, period_start, period_end,
  base_income_cents, penalty_cents, reward_cents, adjustment_cents,
  gross_cents, tax_cents, net_cents, status,
  review_pending_at, confirm_pending_at, confirmed_at, completed_at,
  reviewed_by, confirmed_by, completed_by, note, created_at, updated_at
)
select
  m.id, m.makeup_profile_id, p.id, m.month, m.period_start, m.period_end,
  m.base_income_cents, m.penalty_cents, m.reward_cents, m.adjustment_cents,
  m.gross_cents, m.tax_cents, m.net_cents, m.status,
  m.review_pending_at, m.confirm_pending_at, m.confirmed_at, m.completed_at,
  m.reviewed_by, m.confirmed_by, m.completed_by, m.note, m.created_at, m.updated_at
from public.makeup_salary_records m
cross join (select id from public.positions where code = 'makeup') p;

insert into public.staff_salary_record_status_logs
  (id, salary_record_id, from_status, to_status, operator_profile_id, note, created_at)
select id, salary_record_id, from_status, to_status, operator_profile_id, note, created_at
from public.makeup_salary_record_status_logs;

-- ---------- 5. 废弃化妆师专用表与函数 ----------
-- 先删表（连带删除依赖的 trigger），再删函数。
drop table if exists public.makeup_salary_record_status_logs;
drop table if exists public.makeup_salary_records;
drop function if exists public.create_makeup_salary_records(date, date, jsonb);
drop function if exists public.recompute_makeup_salary_record(uuid, text);
drop function if exists public.transition_makeup_salary_status(uuid, public.salary_record_status, uuid, text);
drop function if exists public.guard_makeup_salary_member_update();

-- ---------- 6. 基础薪资设置 RPC（按职位写对应列） ----------
create or replace function public.set_staff_base_income(
  p_profile_id uuid,
  p_position_code text,
  p_cents bigint
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() is not true then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_cents is null or p_cents < 0 then
    raise exception 'INVALID_BASE_INCOME' using errcode = '22023';
  end if;
  case p_position_code
    when 'makeup' then
      update public.profiles set makeup_base_income_cents = p_cents, updated_at = now() where id = p_profile_id;
    when 'dance' then
      update public.profiles set dance_base_income_cents = p_cents, updated_at = now() where id = p_profile_id;
    when 'executive' then
      update public.profiles set executive_base_income_cents = p_cents, updated_at = now() where id = p_profile_id;
    when 'camera' then
      update public.profiles set camera_base_income_cents = p_cents, updated_at = now() where id = p_profile_id;
    when 'hr' then
      update public.profiles set hr_base_income_cents = p_cents, updated_at = now() where id = p_profile_id;
    else
      raise exception 'UNSUPPORTED_POSITION:%', p_position_code using errcode = '22023';
  end case;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.set_staff_base_income(uuid, text, bigint) from public, anon, service_role;
grant execute on function public.set_staff_base_income(uuid, text, bigint) to authenticated;

-- ---------- 7. 新增/覆盖工资条（管理员手填总违约/总奖励） ----------
-- p_records 每项：{ profileId, positionId, penaltyCents?, rewardCents?, note? }
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
  ) then
    raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
  end if;

  v_month := date_trunc('month', p_period_start)::date;

  for m in select * from jsonb_array_elements(p_records)
  loop
    v_profile_id := (m->>'profileId')::uuid;
    v_position_id := (m->>'positionId')::bigint;

    select pos.code,
           case pos.code
             when 'makeup' then pr.makeup_base_income_cents
             when 'dance' then pr.dance_base_income_cents
             when 'executive' then pr.executive_base_income_cents
             when 'camera' then pr.camera_base_income_cents
             when 'hr' then pr.hr_base_income_cents
             else null
           end
      into v_position_code, v_base
    from public.profiles pr
    join public.positions pos on pos.id = v_position_id
    where pr.id = v_profile_id;
    if v_base is null then
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
    if v_penalty > 0 or v_reward < 0 then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;
    v_adjust := v_penalty + v_reward;
    v_gross := v_base + v_adjust;

    v_tax := public.apply_income_tax(v_profile_id, v_month, v_gross);
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

-- ---------- 8. 驳回重算 ----------
create or replace function public.recompute_staff_salary_record(
  p_id uuid,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.staff_salary_records%rowtype;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_gross bigint;
  v_tax bigint;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;
  select * into rec from public.staff_salary_records where id = p_id for update;
  if not found then
    raise exception 'STAFF_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if rec.status <> 'pending_review'::public.salary_record_status then
    raise exception 'INVALID_TRANSITION:%->pending_review', rec.status using errcode = '22023';
  end if;

  v_gross := rec.base_income_cents + rec.penalty_cents + rec.reward_cents;
  v_tax := public.apply_income_tax(rec.profile_id, rec.month, v_gross);

  update public.staff_salary_records set
    adjustment_cents = rec.penalty_cents + rec.reward_cents,
    gross_cents = v_gross,
    tax_cents = v_tax,
    net_cents = v_gross - v_tax,
    status = 'pending_review'::public.salary_record_status,
    review_pending_at = v_now,
    updated_at = v_now
  where id = p_id;

  insert into public.staff_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review'::public.salary_record_status,
          'pending_review'::public.salary_record_status, v_operator,
          coalesce(p_note, '管理员驳回，已重新计算工资条'));
end $$;
revoke all on function public.recompute_staff_salary_record(uuid, text)
  from public, anon, service_role;
grant execute on function public.recompute_staff_salary_record(uuid, text)
  to authenticated;

-- ---------- 9. 状态流转（四态） ----------
create or replace function public.transition_staff_salary_status(
  p_id uuid,
  p_to_status public.salary_record_status,
  p_operator_profile_id uuid default null,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_from public.salary_record_status;
  v_profile_id uuid;
  v_is_admin boolean := public.is_admin();
  v_caller uuid := public.current_profile_id();
  v_operator uuid;
  v_now timestamptz := now();
begin
  select status, profile_id into v_from, v_profile_id
  from public.staff_salary_records where id = p_id for update;
  if not found then
    raise exception 'STAFF_SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if v_profile_id is distinct from v_caller
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
    raise exception 'INVALID_TRANSITION:%->%', v_from, p_to_status using errcode = '22023';
  end if;

  update public.staff_salary_records
  set status = p_to_status,
      updated_at = v_now,
      confirm_pending_at = case when p_to_status = 'pending_confirm' then v_now else confirm_pending_at end,
      confirmed_at       = case when p_to_status = 'confirmed'       then v_now else confirmed_at end,
      completed_at       = case when p_to_status = 'completed'       then v_now else completed_at end,
      reviewed_by  = case when p_to_status = 'pending_confirm' and v_operator is not null then v_operator else reviewed_by end,
      confirmed_by = case when p_to_status = 'confirmed'       and v_operator is not null then v_operator else confirmed_by end,
      completed_by = case when p_to_status = 'completed'       and v_operator is not null then v_operator else completed_by end
  where id = p_id and status = v_from;

  insert into public.staff_salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, v_from, p_to_status, v_operator, p_note);

  if p_to_status = 'pending_confirm' then
    insert into public.notifications (profile_id, type, title, body, ref_id)
    values (v_profile_id, 'payslip_pending', '工资条待确认', '您有一份新的工资条待确认，请及时查看。', p_id);
  end if;
end $$;
revoke all on function public.transition_staff_salary_status(uuid, public.salary_record_status, uuid, text)
  from public, anon, service_role;
grant execute on function public.transition_staff_salary_status(uuid, public.salary_record_status, uuid, text)
  to authenticated;

-- ---------- 10. RLS ----------
alter table public.staff_salary_records enable row level security;
alter table public.staff_salary_record_status_logs enable row level security;

create policy staff_salary_records_select on public.staff_salary_records for select to authenticated
  using (
    public.is_admin()
    or (profile_id = public.current_profile_id() and status <> 'pending_review')
  );
create policy staff_salary_records_insert on public.staff_salary_records for insert to authenticated
  with check (public.is_admin());
create policy staff_salary_records_update on public.staff_salary_records for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy staff_salary_records_member_confirm on public.staff_salary_records for update to authenticated
  using (profile_id = public.current_profile_id() and status = 'pending_confirm')
  with check (profile_id = public.current_profile_id() and status = 'confirmed');

create or replace function public.guard_staff_salary_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.profile_id is distinct from old.profile_id
     or new.position_id is distinct from old.position_id
     or new.month is distinct from old.month
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.base_income_cents is distinct from old.base_income_cents
     or new.penalty_cents is distinct from old.penalty_cents
     or new.reward_cents is distinct from old.reward_cents
     or new.adjustment_cents is distinct from old.adjustment_cents
     or new.gross_cents is distinct from old.gross_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.net_cents is distinct from old.net_cents
  then
    raise exception '成员确认工资时不允许修改金额或结算相关字段';
  end if;
  return new;
end $$;
revoke all on function public.guard_staff_salary_member_update() from public, anon, authenticated;

create trigger staff_salary_records_member_update_guard
  before update on public.staff_salary_records
  for each row execute function public.guard_staff_salary_member_update();

create policy staff_salary_logs_select on public.staff_salary_record_status_logs for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.staff_salary_records r
      where r.id = staff_salary_record_status_logs.salary_record_id
        and r.profile_id = public.current_profile_id()
    )
  );
create policy staff_salary_logs_insert on public.staff_salary_record_status_logs for insert to authenticated
  with check (public.is_admin());

-- ---------- 11. 授权 ----------
grant select, insert, update on public.staff_salary_records to authenticated;
grant select, insert on public.staff_salary_record_status_logs to authenticated;
grant all on public.staff_salary_records to service_role;
grant all on public.staff_salary_record_status_logs to service_role;
revoke all on public.staff_salary_records from anon;
revoke all on public.staff_salary_record_status_logs from anon;
