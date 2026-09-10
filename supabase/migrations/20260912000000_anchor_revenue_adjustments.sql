-- 主播流水手动结算 + 调整项（PLAN-001 阶段1/2）
--
-- 背景：既有 settle_team_period 是「团队维度、cron 自动结算」通道，按团队游标
--       last_settled_period_end 幂等推进，不支持管理员在主播流水页「手动勾选
--       部分主播 + 携带不固定调整项」结算。本迁移新增独立通道：
--   1. salary_records 增加 adjustments JSONB（结算时落库的调整项明细数组）；
--   2. 新增 settle_anchor_revenue RPC：只结算入参指定的主播，写入含调整项的
--      工资快照，状态置 pending_review 进入四态审核流；不触碰团队自动结算游标，
--      与自动结算互不干扰。

-- ---------- 1. salary_records 新增调整项字段 ----------
-- 数组元素结构：{ "name": "迟到", "amountCents": -10000 }
alter table public.salary_records
  add column if not exists adjustments jsonb not null default '[]'::jsonb;

-- ---------- 2. 主播流水手动结算 RPC ----------
-- p_members 元素结构（与领域层 AdjustedPayrollResult / data 层对应）：
--   { profileId, positionId, schemeId, revenueCents, tenureMonth, baseGuaranteeCents,
--     thresholdCents, commissionStartCents, commissionRateBps, isQualified, isGracePeriod,
--     guaranteedComponentCents, performanceComponentCents, grossCents, serviceFeeCents,
--     netCents, adjustments }
-- 说明：
--   - 只结算入参列出的主播（手动勾选），不遍历团队全员；
--   - 不推进 teams.last_settled_period_end（避免与自动结算游标相互覆盖）；
--   - upsert：同一 (team_id, profile_id, position_id, period_start, period_end) 已存在则覆盖
--     金额快照与调整项，并重置为 pending_review（允许管理员改调整项后再次结算）。
create or replace function public.settle_anchor_revenue(
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
  v_month date := date_trunc('month', p_period_start)::date;
  v_now timestamptz := now();
  v_operator uuid := public.current_profile_id();
  v_count integer := 0;
  m jsonb;
  v_record_id uuid;
  v_inserted boolean;
begin
  -- 鉴权：仅管理员可手动结算。
  if not public.is_admin() then
    raise exception 'FORBIDDEN_TRANSITION' using errcode = 'P0001';
  end if;

  -- 行锁团队，串行化同一团队并发结算。
  perform 1 from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  for m in select * from jsonb_array_elements(p_members)
  loop
    insert into public.salary_records (
      profile_id, position_id, scheme_id, month, team_id,
      period_start, period_end, revenue_cents, tenure_month,
      base_guarantee_cents, threshold_cents, commission_start_cents, commission_rate_bps,
      is_qualified, is_grace_period, guaranteed_component_cents,
      performance_component_cents, gross_cents, service_fee_cents, net_cents,
      adjustments, status, review_pending_at
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
      (m->>'baseGuaranteeCents')::bigint,
      (m->>'thresholdCents')::bigint,
      (m->>'commissionStartCents')::bigint,
      (m->>'commissionRateBps')::integer,
      (m->>'isQualified')::boolean,
      (m->>'isGracePeriod')::boolean,
      (m->>'guaranteedComponentCents')::bigint,
      (m->>'performanceComponentCents')::bigint,
      (m->>'grossCents')::bigint,
      (m->>'serviceFeeCents')::bigint,
      (m->>'netCents')::bigint,
      coalesce(m->'adjustments', '[]'::jsonb),
      'pending_review',
      v_now
    )
    on conflict (team_id, profile_id, position_id, period_start, period_end)
    where team_id is not null and period_start is not null and period_end is not null
    do update set
      scheme_id = excluded.scheme_id,
      revenue_cents = excluded.revenue_cents,
      tenure_month = excluded.tenure_month,
      base_guarantee_cents = excluded.base_guarantee_cents,
      threshold_cents = excluded.threshold_cents,
      commission_start_cents = excluded.commission_start_cents,
      commission_rate_bps = excluded.commission_rate_bps,
      is_qualified = excluded.is_qualified,
      is_grace_period = excluded.is_grace_period,
      guaranteed_component_cents = excluded.guaranteed_component_cents,
      performance_component_cents = excluded.performance_component_cents,
      gross_cents = excluded.gross_cents,
      service_fee_cents = excluded.service_fee_cents,
      net_cents = excluded.net_cents,
      adjustments = excluded.adjustments,
      status = 'pending_review',
      review_pending_at = v_now,
      updated_at = v_now
    returning id, (xmax = 0) into v_record_id, v_inserted;

    insert into public.salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null else 'pending_review' end,
      'pending_review',
      v_operator,
      case when v_inserted then '管理员手动结算生成' else '管理员手动重新结算（含调整项）' end
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb) from public, anon;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb) to authenticated;