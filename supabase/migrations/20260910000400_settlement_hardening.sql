-- 结算健壮性加固（PLAN-001 阶段3 二次审查修复）
--
-- 本迁移解决二次审查发现的根因级缺陷：
--   P1-唯一键：salary_records 原 unique(profile_id, position_id, month) 使同一自然月内
--              多个自定义周期互相覆盖。新增业务唯一键(团队+成员+岗位+周期起止)。
--   P1-日志伪造：收敛 salary_record_status_logs 写入权限，成员不可再直接 insert 日志；
--               日志仅由 SECURITY DEFINER RPC 或 service_role 写入。
--   P2-历史建模：team_members 增加 joined_at/left_at 在组区间，结算按周期与在组区间取交集。

-- ---------- P0：清除旧唯一约束 + 建立业务唯一键 ----------
-- 旧 unique(profile_id, position_id, month) 会使同一自然月内不同自定义周期落到同一 month
-- 而互相冲突（插入第二个周期会撞旧约束）。必须先删除该表级约束，新的业务唯一键才能生效。
-- 删除后，个人版/无周期记录改由下方部分唯一索引兜底（month 场景仍受业务键约束覆盖）。
alter table public.salary_records
  drop constraint if exists salary_records_profile_id_position_id_month_key;

-- 兼容无团队/周期的历史个人记录：以「成员+岗位+自然月」为唯一键（仅当不带周期时生效）。
create unique index salary_records_month_key_idx
  on public.salary_records (profile_id, position_id, month)
  where period_start is null and period_end is null;

-- 带团队与周期时，以「团队+成员+岗位+周期起止」为业务唯一键，
-- 避免同一自然月内不同自定义周期落到同一 month 而互相覆盖。
create unique index salary_records_business_key_idx
  on public.salary_records (team_id, profile_id, position_id, period_start, period_end)
  where team_id is not null and period_start is not null and period_end is not null;

-- ---------- P1：收敛状态日志写入权限 ----------
-- 原策略允许「记录归属成员」直接 insert 日志 → 成员可伪造 from/to/operator/note。
-- 改为：仅管理员可经 RLS 写入；成员端状态流转统一走 transition_salary_status RPC
-- （SECURITY DEFINER，以受控参数写入日志），service_role（Edge Function）绕过 RLS。
drop policy if exists salary_status_logs_insert on public.salary_record_status_logs;
create policy salary_status_logs_insert on public.salary_record_status_logs for insert to authenticated
  with check (public.is_admin());

-- ---------- P2：成员在组区间 ----------
-- 原 team_members 无 joined_at/left_at，历史周期结算会用「当前成员」而非「周期内在组成员」。
-- 增加区间字段：joined_at 默认取 created_at；left_at 为空表示仍在组。
alter table public.team_members
  add column joined_at date not null default current_date,
  add column left_at date;

-- 历史数据：已存在的成员 joined_at 回填为其 created_at 当日。
update public.team_members set joined_at = created_at::date where joined_at = current_date;

-- 区间合法性：left_at 必须不早于 joined_at。
alter table public.team_members
  add constraint team_members_interval_chk
  check (left_at is null or left_at >= joined_at);

-- ---------- P1：成员软删除 + 可重入组 ----------
-- 原约束阻碍历史闭环：
--   * profile_id 全局 unique → 成员一旦离组便永久无法再入任何团队；
--   * 主键 (team_id, profile_id) → 同一成员在同一团队的多段在组历史无法并存。
-- 改造为「代理主键 + 活跃期唯一」模型：
--   1. 新增代理主键 id，允许同一 (team_id, profile_id) 存在多条历史区间行；
--   2. 全局唯一收敛为「仅活跃行 profile_id 唯一」→ 保证同一时刻只属一个团队，离组后可重入；
--   3. 同一团队内同一成员至多一条活跃行，避免重复在组。
alter table public.team_members drop constraint team_members_pkey;
alter table public.team_members drop constraint team_members_profile_id_key;
alter table public.team_members add column id uuid primary key default gen_random_uuid();

-- 活跃期（left_at is null）内 profile_id 全局唯一：同一时刻仅属一个团队。
create unique index team_members_active_profile_uniq
  on public.team_members (profile_id) where left_at is null;
-- 同一团队内同一成员至多一条活跃行。
create unique index team_members_active_team_profile_uniq
  on public.team_members (team_id, profile_id) where left_at is null;

-- ---------- P0：team_members UPDATE 权限（软删除依赖） ----------
-- removeTeamMember 由物理 delete 改为 update left_at，但原表仅授予 authenticated
-- select/insert/delete 且无 UPDATE RLS 策略 → 管理员软删除必然 permission denied。
-- 补：表级 update grant + 管理员 UPDATE policy（软删除/回填区间均需管理员权限）。
grant update on public.team_members to authenticated;
create policy team_members_update on public.team_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- P0：状态流转事务 RPC ----------
-- 原应用层三次独立请求（update 主表 / insert 日志 / insert 通知）非事务，
-- 中途失败会留下半完成态。收敛为单个 SECURITY DEFINER 函数，在一个事务内完成：
--   1. 行锁读取当前记录（select ... for update，防并发流转互相覆盖）
--   2. 校验四态合法转换 + 权限（管理员，或成员确认己方 pending_confirm→confirmed）
--   3. 更新主表 status + 对应时间戳 + 操作人
--   4. 写状态变更日志
--   5. 审核通过时给成员发站内通知
-- 任一步骤失败则整体回滚。合法转换表与时间戳/操作人字段映射与前端保持同口径。
create or replace function public.transition_salary_status(
  p_id uuid,
  p_to_status public.salary_record_status,
  p_operator_profile_id uuid default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.salary_record_status;
  v_profile_id uuid;
  v_is_admin boolean := public.is_admin();
  v_caller uuid := public.current_profile_id();
  v_operator uuid;
  v_now timestamptz := now();
begin
  -- 行锁读取，阻塞并发流转直至本事务结束。
  select status, profile_id into v_from, v_profile_id
  from public.salary_records
  where id = p_id
  for update;

  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 权限：管理员全量；否则仅允许记录归属成员执行 pending_confirm→confirmed。
  if not v_is_admin then
    if v_profile_id is distinct from v_caller
       or v_from <> 'pending_confirm'
       or p_to_status <> 'confirmed' then
      raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  -- 操作人权威取值：管理员可显式指定操作人（如代操作/批处理），
  -- 非管理员一律强制为调用者本人，杜绝伪造 confirmed_by / 日志操作人。
  v_operator := case when v_is_admin then coalesce(p_operator_profile_id, v_caller) else v_caller end;

  -- 四态合法转换校验。
  if not (
       (v_from = 'pending_review'  and p_to_status = 'pending_confirm')
    or (v_from = 'pending_confirm' and p_to_status = 'confirmed')
    or (v_from = 'confirmed'       and p_to_status = 'completed')
  ) then
    raise exception 'INVALID_TRANSITION:%->%', v_from, p_to_status
      using errcode = '22023';
  end if;

  -- 更新主表 status + 对应最新时间戳 + 操作人（乐观锁隐含于 for update + status 条件）。
  update public.salary_records
  set status = p_to_status,
      updated_at = v_now,
      confirm_pending_at = case when p_to_status = 'pending_confirm' then v_now else confirm_pending_at end,
      confirmed_at       = case when p_to_status = 'confirmed'       then v_now else confirmed_at end,
      completed_at       = case when p_to_status = 'completed'       then v_now else completed_at end,
      reviewed_by  = case when p_to_status = 'pending_confirm' and v_operator is not null then v_operator else reviewed_by end,
      confirmed_by = case when p_to_status = 'confirmed'       and v_operator is not null then v_operator else confirmed_by end,
      completed_by = case when p_to_status = 'completed'       and v_operator is not null then v_operator else completed_by end
  where id = p_id and status = v_from;

  -- 写状态轨迹日志（受控参数，成员无法伪造）。
  insert into public.salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, v_from, p_to_status, v_operator, p_note);

  -- 审核通过 → 给成员发「工资条待确认」站内通知。
  if p_to_status = 'pending_confirm' then
    insert into public.notifications (profile_id, type, title, body, ref_id)
    values (v_profile_id, 'payslip_pending', '工资条待确认', '您有一份新的工资条待确认，请及时查看。', p_id);
  end if;
end $$;

revoke all on function public.transition_salary_status(uuid, public.salary_record_status, uuid, text) from public, anon;
grant execute on function public.transition_salary_status(uuid, public.salary_record_status, uuid, text) to authenticated;

-- ---------- P0/P1：团队周期结算事务 RPC（行锁 + 原子落库） ----------
-- 原 Edge Function 逐成员 upsert + 逐条 insert 日志 + 更新游标全部非事务、无锁：
--   * 并发触发无互斥 → 重复结算 / 游标竞争覆盖
--   * 中途失败留半完成态 + 重复日志
-- 收敛策略：薪资计算仍在 Edge Function（service_role）内完成（避免与 TS 口径漂移），
-- 但「落库」整体交给本 RPC，在单事务内：
--   1. 行锁团队（select ... for update）→ 天然串行化同一团队的并发结算
--   2. 幂等校验：last_settled_period_end = period_end 则直接返回 0
--   3. 遍历传入的成员结果 jsonb 数组，按业务唯一键 upsert salary_records
--   4. 仅对「本次新建」的记录插入 to=pending_review 日志（更新已存在记录不重复插日志）
--   5. 推进 last_settled_period_end
-- 任一步失败整体回滚，游标不推进，下次触发重试。
-- p_members 元素结构（与 Edge Function 输出对应）：
--   { profileId, positionId, schemeId, revenueCents, tenureMonth, thresholdCents,
--     isQualified, isGracePeriod, guaranteedComponentCents, performanceComponentCents,
--     grossCents, serviceFeeCents, netCents, commissionRateBps }
create or replace function public.settle_team_period(
  p_team_id uuid,
  p_period_start date,
  p_period_end date,
  p_members jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_end date;
  v_month date := date_trunc('month', p_period_start)::date;
  v_now timestamptz := now();
  v_count integer := 0;
  m jsonb;
  v_record_id uuid;
  v_inserted boolean;
begin
  -- 行锁团队，串行化同一团队并发结算。
  select last_settled_period_end into v_last_end
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 幂等 + 防倒退：该周期已结算，或游标已推进到更晚周期，则跳过，
  -- 避免并发/旧周期请求把 last_settled_period_end 倒退或重复覆盖。
  if v_last_end is not null and v_last_end >= p_period_end then
    return 0;
  end if;

  for m in select * from jsonb_array_elements(p_members)
  loop
    insert into public.salary_records (
      profile_id, position_id, scheme_id, month, team_id,
      period_start, period_end, revenue_cents, tenure_month, threshold_cents,
      is_qualified, is_grace_period, guaranteed_component_cents,
      performance_component_cents, gross_cents, service_fee_cents, net_cents,
      commission_rate_bps, status, review_pending_at
    ) values (
      (m->>'profileId')::uuid,
      (m->>'positionId')::bigint,
      nullif(m->>'schemeId','')::uuid,
      v_month,
      p_team_id,
      p_period_start,
      p_period_end,
      (m->>'revenueCents')::bigint,
      (m->>'tenureMonth')::integer,
      (m->>'thresholdCents')::bigint,
      (m->>'isQualified')::boolean,
      (m->>'isGracePeriod')::boolean,
      (m->>'guaranteedComponentCents')::bigint,
      (m->>'performanceComponentCents')::bigint,
      (m->>'grossCents')::bigint,
      (m->>'serviceFeeCents')::bigint,
      (m->>'netCents')::bigint,
      (m->>'commissionRateBps')::integer,
      'pending_review',
      v_now
    )
    on conflict (team_id, profile_id, position_id, period_start, period_end)
    where team_id is not null and period_start is not null and period_end is not null
    do update set
      scheme_id = excluded.scheme_id,
      revenue_cents = excluded.revenue_cents,
      tenure_month = excluded.tenure_month,
      threshold_cents = excluded.threshold_cents,
      is_qualified = excluded.is_qualified,
      is_grace_period = excluded.is_grace_period,
      guaranteed_component_cents = excluded.guaranteed_component_cents,
      performance_component_cents = excluded.performance_component_cents,
      gross_cents = excluded.gross_cents,
      service_fee_cents = excluded.service_fee_cents,
      net_cents = excluded.net_cents,
      commission_rate_bps = excluded.commission_rate_bps,
      updated_at = v_now
    returning id, (xmax = 0) into v_record_id, v_inserted;

    -- 仅对本次新建的记录写「系统自动结算生成」日志，避免重试时重复插日志。
    if v_inserted then
      insert into public.salary_record_status_logs
        (salary_record_id, from_status, to_status, operator_profile_id, note)
      values (v_record_id, null, 'pending_review', null, '系统自动结算生成');
    end if;

    v_count := v_count + 1;
  end loop;

  -- 推进结算游标。
  update public.teams
  set last_settled_period_end = p_period_end
  where id = p_team_id;

  return v_count;
end $$;

revoke all on function public.settle_team_period(uuid, date, date, jsonb) from public, anon, authenticated;
-- Edge Function 以 service_role 调用本 RPC，必须显式授权，否则 rpc() 报 permission denied。
grant execute on function public.settle_team_period(uuid, date, date, jsonb) to service_role;

-- ---------- P1：驳回重算事务 RPC（行锁 + 原子落库） ----------
-- 原应用层「update 主表 + insert 日志」两次独立请求非事务，中途失败会留半完成态
-- （记录已回到 pending_review 但缺日志，或反之）。收敛为单个 SECURITY DEFINER 事务：
--   1. 行锁读取记录，校验仅 pending_review 可驳回重算 + 管理员权限
--   2. 用库外重算结果（避免 TS/PLpgSQL 口径漂移）整体更新主表字段并置回 pending_review
--   3. 写状态轨迹日志
-- 任一步失败整体回滚。
create or replace function public.recompute_salary_record(
  p_id uuid,
  p_revenue_cents bigint,
  p_tenure_month integer,
  p_threshold_cents bigint,
  p_is_qualified boolean,
  p_is_grace_period boolean,
  p_guaranteed_component_cents bigint,
  p_performance_component_cents bigint,
  p_gross_cents bigint,
  p_service_fee_cents bigint,
  p_net_cents bigint,
  p_commission_rate_bps integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.salary_record_status;
  v_operator uuid := public.current_profile_id();
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;

  -- 行锁读取，阻塞并发流转/重算。
  select status into v_status
  from public.salary_records
  where id = p_id
  for update;

  if not found then
    raise exception 'SALARY_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION:%->pending_review', v_status using errcode = '22023';
  end if;

  update public.salary_records
  set revenue_cents = p_revenue_cents,
      tenure_month = p_tenure_month,
      threshold_cents = p_threshold_cents,
      is_qualified = p_is_qualified,
      is_grace_period = p_is_grace_period,
      guaranteed_component_cents = p_guaranteed_component_cents,
      performance_component_cents = p_performance_component_cents,
      gross_cents = p_gross_cents,
      service_fee_cents = p_service_fee_cents,
      net_cents = p_net_cents,
      commission_rate_bps = p_commission_rate_bps,
      status = 'pending_review',
      review_pending_at = v_now,
      updated_at = v_now
  where id = p_id;

  insert into public.salary_record_status_logs
    (salary_record_id, from_status, to_status, operator_profile_id, note)
  values (p_id, 'pending_review', 'pending_review', v_operator, coalesce(p_note, '管理员驳回，已按当前流水重新计算'));
end $$;

revoke all on function public.recompute_salary_record(uuid, bigint, integer, bigint, boolean, boolean, bigint, bigint, bigint, bigint, bigint, integer, text) from public, anon;
grant execute on function public.recompute_salary_record(uuid, bigint, integer, bigint, boolean, boolean, bigint, bigint, bigint, bigint, bigint, integer, text) to authenticated;