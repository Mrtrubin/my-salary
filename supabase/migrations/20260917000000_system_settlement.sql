-- 多团与全系统周期：只迁移周期元数据，不删除、合并或重算历史工资金额。
-- 手动入口仅管理员；自动入口仅 service_role，force 不再允许自动覆盖工资。
-- 所有预检、DDL、回填和函数替换同事务，任何异常均完整回滚。
begin;

lock table public.teams, public.team_members, public.salary_records in access exclusive mode;

-- 按实际周期规范化：monthly 忽略旧起始日，custom/1 等价于 monthly/1。
-- 包括停用团队，不能擅自选一个团队或取最大游标。
do $$
begin
  if (select count(distinct case when settlement_type = 'monthly' then 1
                                else settlement_start_day end) from public.teams) > 1 then
    raise exception 'SYSTEM_SETTLEMENT_CONFIG_CONFLICT'
      using errcode = '22023', hint = '团队周期不一致；请先人工统一配置后重试迁移。';
  end if;
  if exists (
    select 1 from public.salary_records
    where (period_start is null) <> (period_end is null)
       or not isfinite(month)
       or (period_start is not null and
           (not isfinite(period_start) or not isfinite(period_end) or period_start > period_end))
  ) then
    raise exception 'INVALID_EXISTING_SALARY_PERIOD' using errcode = '22023';
  end if;
  -- 旧无周期记录按其自然月解释；先与所有团队及系统记录一起检查。
  if exists (
    with periods as (
      select id, profile_id, position_id,
             coalesce(period_start, month) as starts,
             coalesce(period_end, (month + interval '1 month')::date - 1) as ends
      from public.salary_records
    )
    select 1 from periods a join periods b
      on a.id < b.id and a.profile_id = b.profile_id and a.position_id = b.position_id
     and a.starts <= b.ends and b.starts <= a.ends
  ) then
    raise exception 'EXISTING_SALARY_PERIOD_OVERLAP'
      using errcode = '23P01', hint = '存在同人同岗位重复或重叠工资；迁移不会删除或合并记录。';
  end if;
end $$;

create table public.system_settlement_settings (
  id boolean primary key default true check (id),
  settlement_type public.settlement_type not null default 'monthly',
  settlement_start_day integer not null default 1 check (settlement_start_day between 1 and 28),
  last_settled_period_end date,
  updated_at timestamptz not null default now(),
  constraint system_settlement_monthly_day_check
    check (settlement_type <> 'monthly' or settlement_start_day = 1),
  constraint system_settlement_cursor_finite_check
    check (last_settled_period_end is null or isfinite(last_settled_period_end))
);

insert into public.system_settlement_settings (settlement_type, settlement_start_day)
select case when day = 1 then 'monthly'::public.settlement_type
            else 'custom'::public.settlement_type end, day
from (
  select coalesce(min(case when settlement_type = 'monthly' then 1
                          else settlement_start_day end), 1) as day
  from public.teams
) normalized;
-- 系统游标故意保持 NULL；历史工资而非团队游标决定幂等性。

alter table public.system_settlement_settings enable row level security;
revoke all on public.system_settlement_settings from public, anon, authenticated, service_role;
grant select on public.system_settlement_settings to authenticated, service_role;
grant update (settlement_type, settlement_start_day)
  on public.system_settlement_settings to authenticated;
grant update (last_settled_period_end) on public.system_settlement_settings to service_role;
create policy system_settlement_settings_read on public.system_settlement_settings
  for select to authenticated using (public.current_profile_id() is not null);
create policy system_settlement_settings_admin_update on public.system_settlement_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 仅移除跨团队活跃唯一，保留 team_members_active_team_profile_uniq。
drop index public.team_members_active_profile_uniq;

-- 已核对旧定义：自然月部分唯一索引只覆盖两端均 NULL 的记录。
-- 补齐其自然月边界后，以不含 team_id 的唯一键统一所有工资。
alter table public.salary_records disable trigger salary_records_member_update_guard;
update public.salary_records
set period_start = month, period_end = (month + interval '1 month')::date - 1
where period_start is null and period_end is null;
alter table public.salary_records enable trigger salary_records_member_update_guard;
alter table public.salary_records
  alter column period_start set not null,
  alter column period_end set not null,
  add constraint salary_records_valid_period_check
    check (isfinite(period_start) and isfinite(period_end) and period_start <= period_end);

-- 兼容曾以不同名字建立的旧 month 唯一约束/索引，按目录中的列定义识别。
do $$
declare r record;
begin
  for r in
    select i.indexrelid, c.conname, ni.nspname, ci.relname
    from pg_catalog.pg_index i
    join pg_catalog.pg_class ci on ci.oid = i.indexrelid
    join pg_catalog.pg_namespace ni on ni.oid = ci.relnamespace
    left join pg_catalog.pg_constraint c on c.conindid = i.indexrelid
    where i.indrelid = 'public.salary_records'::regclass and i.indisunique
      and not i.indisprimary and i.indnkeyatts = 3
      and (select array_agg(a.attname::text order by a.attname)
           from unnest(i.indkey::smallint[]) with ordinality k(attnum, n)
           join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
           where k.n <= i.indnkeyatts) = array['month', 'position_id', 'profile_id']::text[]
  loop
    if r.conname is not null then
      execute format('alter table public.salary_records drop constraint %I', r.conname);
    else
      execute format('drop index %I.%I', r.nspname, r.relname);
    end if;
  end loop;
end $$;
drop index public.salary_records_business_key_idx;
create unique index salary_records_person_position_period_key
  on public.salary_records (profile_id, position_id, period_start, period_end);

create or replace function public.guard_system_settlement_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'SYSTEM_SETTLEMENT_SINGLETON_IMMUTABLE' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'SYSTEM_SETTLEMENT_SINGLETON_IMMUTABLE' using errcode = '42501';
  end if;
  if (new.settlement_type, new.settlement_start_day)
     is distinct from (old.settlement_type, old.settlement_start_day) then
    if public.is_admin() is not true then
      raise exception 'ADMIN_REQUIRED' using errcode = '42501';
    end if;
    if new.settlement_type = 'monthly' then new.settlement_start_day := 1; end if;
  end if;
  if new.last_settled_period_end is distinct from old.last_settled_period_end
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED_FOR_CURSOR' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger system_settlement_settings_guard
  before insert or update or delete on public.system_settlement_settings
  for each row execute function public.guard_system_settlement_settings();

-- 先锁单例再更新同一行版本：READ COMMITTED 串行化；旧 RR 快照安全地序列化失败。
-- 仅 SELECT FOR UPDATE 不改变版本，无法独自保护 REPEATABLE READ 的重叠检查。
create or replace function public.lock_system_settlement_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.system_settlement_settings where id for update;
  if not found then raise exception 'SYSTEM_SETTLEMENT_SETTINGS_MISSING'; end if;
  update public.system_settlement_settings set updated_at = updated_at where id;
  return null;
end $$;
create trigger salary_records_system_lock
  before insert or update or delete on public.salary_records
  for each statement execute function public.lock_system_settlement_write();
create trigger teams_system_lock
  before insert or update or delete on public.teams
  for each statement execute function public.lock_system_settlement_write();

create or replace function public.guard_team_system_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.system_settlement_settings%rowtype;
begin
  select * into strict s from public.system_settlement_settings where id for update;
  if tg_op = 'INSERT' then
    new.settlement_type := s.settlement_type;
    new.settlement_start_day := s.settlement_start_day;
  elsif new.settlement_type is distinct from s.settlement_type
     or new.settlement_start_day is distinct from s.settlement_start_day then
    raise exception 'TEAM_SETTLEMENT_MUST_MATCH_SYSTEM' using errcode = '22023';
  end if;
  return new;
end $$;
-- 先规范化所有镜像，再启用团队逐行保护；保留旧团队游标但不再使用它。
update public.teams t
set settlement_type = s.settlement_type, settlement_start_day = s.settlement_start_day
from public.system_settlement_settings s where s.id;
create trigger teams_system_settlement_guard
  before insert or update on public.teams
  for each row execute function public.guard_team_system_settlement();

create or replace function public.sync_system_settlement_to_teams()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.teams
  set settlement_type = new.settlement_type, settlement_start_day = new.settlement_start_day
  where (settlement_type, settlement_start_day)
     is distinct from (new.settlement_type, new.settlement_start_day);
  return new;
end $$;
create trigger system_settlement_settings_sync_teams
  after update on public.system_settlement_settings
  for each row when ((old.settlement_type, old.settlement_start_day)
    is distinct from (new.settlement_type, new.settlement_start_day))
  execute function public.sync_system_settlement_to_teams();

-- 所有直接写入/RPC 共用，周期边界含首尾；精确更新仅排除该记录自身。
-- 不对历史记录套用当前配置：recompute_salary_record 的既有签名及语义不变。
create or replace function public.guard_salary_period_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.system_settlement_settings where id for update;
  if not found then raise exception 'SYSTEM_SETTLEMENT_SETTINGS_MISSING'; end if;
  -- 兼容旧个人月薪写入：两端均空时补成自然月；单端空由 NOT NULL 拒绝。
  if new.period_start is null and new.period_end is null then
    new.period_start := new.month;
    new.period_end := (new.month + interval '1 month')::date - 1;
  end if;
  if exists (
    select 1 from public.salary_records r
    where r.profile_id = new.profile_id and r.position_id = new.position_id
      and (tg_op = 'INSERT' or r.id <> old.id)
      and r.period_start <= new.period_end and new.period_start <= r.period_end
  ) then
    raise exception 'SALARY_PERIOD_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger salary_records_period_overlap_guard
  before insert or update on public.salary_records
  for each row execute function public.guard_salary_period_overlap();

-- 补齐旧成员保护遗漏的新增金额/adjustments字段；成员只能确认，不能篡改工资。
create or replace function public.guard_salary_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() or coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if old.profile_id is distinct from public.current_profile_id()
     or old.status <> 'pending_confirm' or new.status <> 'confirmed'
     or new.confirmed_by is distinct from public.current_profile_id()
     or (to_jsonb(new) - array['status', 'confirmed_at', 'confirmed_by', 'updated_at'])
        is distinct from
        (to_jsonb(old) - array['status', 'confirmed_at', 'confirmed_by', 'updated_at']) then
    raise exception 'FORBIDDEN_SALARY_MEMBER_UPDATE' using errcode = '42501';
  end if;
  new.confirmed_at := now();
  new.updated_at := now();
  return new;
end $$;

-- 内部实现不向 API 角色开放，两个公开入口复用同一鉴权/周期/落库逻辑。
create or replace function public.write_system_settlement(
  p_team_id uuid, p_period_start date, p_period_end date, p_members jsonb, p_manual boolean
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.system_settlement_settings%rowtype;
  m jsonb;
  v_profile_id uuid;
  v_position_id bigint;
  v_record_id uuid;
  v_status public.salary_record_status;
  v_inserted boolean;
  v_count integer := 0;
  v_operator uuid;
  v_now timestamptz := now();
  v_adjustments jsonb;
begin
  if p_manual is null then raise exception 'INVALID_SETTLEMENT_MODE'; end if;
  if p_manual then
    if public.is_admin() is not true then
      raise exception 'ADMIN_REQUIRED' using errcode = '42501';
    end if;
    v_operator := public.current_profile_id();
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select * into s from public.system_settlement_settings where id for update;
  if not found then raise exception 'SYSTEM_SETTLEMENT_SETTINGS_MISSING'; end if;
  -- 改变行版本，使使用旧事务快照的并发结算失败重试，而非漏看已提交工资。
  update public.system_settlement_settings set updated_at = updated_at where id;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end) then
    raise exception 'INVALID_SETTLEMENT_PERIOD' using errcode = '22023';
  end if;
  -- 包含端点；custom 跨月/跨年、闰年均按日历月加法，不按固定天数。
  if extract(day from p_period_start)::integer <>
       (case when s.settlement_type = 'monthly' then 1 else s.settlement_start_day end)
     or p_period_end <> (p_period_start + interval '1 month')::date - 1 then
    raise exception 'SETTLEMENT_PERIOD_MUST_MATCH_SYSTEM' using errcode = '22023';
  end if;
  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'INVALID_SETTLEMENT_MEMBERS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) x
    where jsonb_typeof(x) <> 'object'
       or nullif(x->>'profileId', '') is null or nullif(x->>'positionId', '') is null
  ) then
    raise exception 'INVALID_SETTLEMENT_MEMBER' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) x
    group by (x->>'profileId')::uuid, (x->>'positionId')::bigint having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SETTLEMENT_MEMBER_POSITION' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(p_members)
  loop
    v_profile_id := (m->>'profileId')::uuid;
    v_position_id := (m->>'positionId')::bigint;
    select id, status into v_record_id, v_status from public.salary_records
    where profile_id = v_profile_id and position_id = v_position_id
      and period_start = p_period_start and period_end = p_period_end
    for update;
    v_inserted := not found;
    if not v_inserted then
      -- 自动永不覆盖，包括管理员调整过的 pending_review；不依赖任何游标短路。
      if not p_manual then continue; end if;
      if v_status <> 'pending_review'::public.salary_record_status then
        raise exception 'SALARY_RECORD_NOT_PENDING_REVIEW' using errcode = '22023';
      end if;
    end if;
    v_adjustments := coalesce(nullif(m->'adjustments', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(v_adjustments) <> 'array' then
      raise exception 'INVALID_SALARY_ADJUSTMENTS' using errcode = '22023';
    end if;

    -- 已有精确周期走 UPDATE，不用 INSERT ON CONFLICT 绕过重叠触发器。
    -- 新建或手动更新均为系统工资；历史已完成/自动跳过的记录保留旧 team_id。
    if v_inserted then
      insert into public.salary_records (
        profile_id, position_id, scheme_id, month, team_id, period_start, period_end,
        revenue_cents, tenure_month, base_guarantee_cents, threshold_cents,
        commission_start_cents, commission_rate_bps, is_qualified, is_grace_period,
        guaranteed_component_cents, performance_component_cents, gross_cents,
        service_fee_cents, net_cents, adjustments, status, review_pending_at
      ) values (
        v_profile_id, v_position_id, nullif(m->>'schemeId', '')::uuid,
        date_trunc('month', p_period_start)::date, null, p_period_start, p_period_end,
        (m->>'revenueCents')::bigint, (m->>'tenureMonth')::integer,
        (m->>'baseGuaranteeCents')::bigint, (m->>'thresholdCents')::bigint,
        (m->>'commissionStartCents')::bigint, (m->>'commissionRateBps')::integer,
        (m->>'isQualified')::boolean, (m->>'isGracePeriod')::boolean,
        (m->>'guaranteedComponentCents')::bigint, (m->>'performanceComponentCents')::bigint,
        (m->>'grossCents')::bigint, (m->>'serviceFeeCents')::bigint, (m->>'netCents')::bigint,
        v_adjustments, 'pending_review'::public.salary_record_status, v_now
      ) returning id into v_record_id;
    else
      update public.salary_records set
        team_id = null,
        scheme_id = nullif(m->>'schemeId', '')::uuid,
        revenue_cents = (m->>'revenueCents')::bigint,
        tenure_month = (m->>'tenureMonth')::integer,
        base_guarantee_cents = (m->>'baseGuaranteeCents')::bigint,
        threshold_cents = (m->>'thresholdCents')::bigint,
        commission_start_cents = (m->>'commissionStartCents')::bigint,
        commission_rate_bps = (m->>'commissionRateBps')::integer,
        is_qualified = (m->>'isQualified')::boolean,
        is_grace_period = (m->>'isGracePeriod')::boolean,
        guaranteed_component_cents = (m->>'guaranteedComponentCents')::bigint,
        performance_component_cents = (m->>'performanceComponentCents')::bigint,
        gross_cents = (m->>'grossCents')::bigint,
        service_fee_cents = (m->>'serviceFeeCents')::bigint,
        net_cents = (m->>'netCents')::bigint,
        adjustments = v_adjustments,
        status = 'pending_review'::public.salary_record_status,
        review_pending_at = v_now, updated_at = v_now
      where id = v_record_id;
    end if;
    insert into public.salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status
           else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status, v_operator,
      case when not p_manual then '系统自动结算生成'
           when v_inserted then '管理员手动结算生成'
           else '管理员手动重新结算（含调整项）' end
    );
    v_count := v_count + 1;
  end loop;
  if not p_manual then
    update public.system_settlement_settings
    set last_settled_period_end = p_period_end
    where id and (last_settled_period_end is null or last_settled_period_end < p_period_end);
  end if;
  -- 手动不推进任何游标；自动仅推进系统游标，永不更新旧团队游标。
  return v_count;
end $$;

create or replace function public.settle_anchor_revenue(
  p_team_id uuid, p_period_start date, p_period_end date, p_members jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  return public.write_system_settlement(p_team_id, p_period_start, p_period_end, p_members, true);
end $$;

-- 删除未曾被旧迁移删除的四参重载，防止旧逻辑绕过系统锁/权限且消除默认参数歧义。
-- 四参数调用仍由以下五参数函数的 DEFAULT false 接收。
drop function if exists public.settle_team_period(uuid, date, date, jsonb);
create or replace function public.settle_team_period(
  p_team_id uuid, p_period_start date, p_period_end date, p_members jsonb,
  p_force boolean default false
)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  -- p_force 只为既有调用签名保留，不得重新启用覆盖或跳过保护。
  return public.write_system_settlement(p_team_id, p_period_start, p_period_end, p_members, false);
end $$;

revoke all on function public.write_system_settlement(uuid, date, date, jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb) to authenticated;
revoke all on function public.settle_team_period(uuid, date, date, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_team_period(uuid, date, date, jsonb, boolean) to service_role;
revoke all on function public.guard_system_settlement_settings(),
  public.lock_system_settlement_write(), public.guard_team_system_settlement(),
  public.sync_system_settlement_to_teams(), public.guard_salary_period_overlap(),
  public.guard_salary_member_update() from public, anon, authenticated, service_role;

-- SECURITY DEFINER 全部固定 search_path；未新增任何工资读取授权或成员写金额权限。
-- 原重算/状态流转 RPC 会先锁工资再触发全局锁，与全局结算并发时可能死锁；
-- PostgreSQL 会原子回滚其中一个事务，调用方应重试 40P01 / 40001，不得忽略失败。
-- 自动调用方应提交系统完整周期名单：p_team_id 仅兼容性校验，不作为金额聚合依据。
commit;