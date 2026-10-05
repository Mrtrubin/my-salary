-- 主持直播时长口径修正：按「团队 + 日期」取 MAX，而不是把所有成员的无绩效记录累加。
--
-- 背景：主持上传主播流水时，接口返回的是各房间直播时长汇总后的「团队当日总直播时长」，
-- 前端 handleApplyIncome 会把这个当日总时长写入当天每个匹配主播的 broadcast_minutes
-- （同一团队同一天所有匹配主播的值相同）。因此：
--   * 团队当日直播时长 = 该团队当天记录的 MAX(broadcast_minutes)（与业绩卡片口径一致）；
--   * 主持周期直播时长 = 汇总周期内所有 (团队, 日期) 的当日值。
-- 原实现直接 SUM 所有记录，会把团队当日时长按成员数放大，故修正为「按日取 MAX 再汇总」。

-- 周期内某主持的总直播时长（分钟）：按 (team_id, perf_date) 取当日最大值后求和。
create or replace function public._host_period_broadcast_minutes(
  p_host_profile_id uuid, p_period_start date, p_period_end date
)
returns integer language sql stable set search_path = '' as $$
  select coalesce(sum(daily), 0)::integer
  from (
    select max(broadcast_minutes) as daily
    from public.anchor_revenue_records
    where host_profile_id = p_host_profile_id
      and perf_date between p_period_start and p_period_end
    group by team_id, perf_date
  ) t;
$$;

-- 按团队拆分明细：流水按成员累加；直播时长按 (团队, 日期) 取 MAX 后再汇总。
create or replace function public._host_period_team_breakdown(
  p_host_profile_id uuid, p_period_start date, p_period_end date
)
returns jsonb language sql stable set search_path = '' as $$
  with daily as (
    select team_id,
           perf_date,
           max(broadcast_minutes) as broadcast_minutes,
           sum(case when no_perf = false then revenue_cents else 0 end) as revenue_cents
    from public.anchor_revenue_records
    where host_profile_id = p_host_profile_id
      and perf_date between p_period_start and p_period_end
    group by team_id, perf_date
  ),
  agg as (
    select d.team_id,
           max(t.name) as team_name,
           sum(d.revenue_cents)::bigint as revenue_cents,
           sum(d.broadcast_minutes)::integer as broadcast_minutes
    from daily d
    left join public.teams t on t.id = d.team_id
    group by d.team_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'teamId', a.team_id,
        'teamName', a.team_name,
        'revenueCents', a.revenue_cents,
        'broadcastMinutes', a.broadcast_minutes
      ) order by a.revenue_cents desc, a.team_name
    ),
    '[]'::jsonb
  )
  from agg a;
$$;
