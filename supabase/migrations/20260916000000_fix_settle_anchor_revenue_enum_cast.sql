-- 修复 settle_anchor_revenue 枚举类型转换报错
--
-- 背景：settle_anchor_revenue 在写入 salary_record_status_logs 时，from_status/to_status
--       列类型为枚举 public.salary_record_status，而 SQL 字面量 'pending_review' 被推断为
--       text，触发 "column from_status is of type public.salary_record_status but expression
--       is of type text"。同理 salary_records.status 写入也需显式转型。
--
-- 说明：20260912000000 已用 create or replace 定义过该函数，但因该 migration 早已被标记为
--       已应用，db push 不会重新执行它。此处以新的 timestamp 补丁 migration 重新定义函数，
--       为所有枚举字面量补上 ::public.salary_record_status 显式转型（含 CASE 的 null 分支）。

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
      'pending_review'::public.salary_record_status,
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
      status = 'pending_review'::public.salary_record_status,
      review_pending_at = v_now,
      updated_at = v_now
    returning id, (xmax = 0) into v_record_id, v_inserted;

    insert into public.salary_record_status_logs
      (salary_record_id, from_status, to_status, operator_profile_id, note)
    values (
      v_record_id,
      case when v_inserted then null::public.salary_record_status else 'pending_review'::public.salary_record_status end,
      'pending_review'::public.salary_record_status,
      v_operator,
      case when v_inserted then '管理员手动结算生成' else '管理员手动重新结算（含调整项）' end
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke all on function public.settle_anchor_revenue(uuid, date, date, jsonb) from public, anon;
grant execute on function public.settle_anchor_revenue(uuid, date, date, jsonb) to authenticated;