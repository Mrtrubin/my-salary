-- 工资方案不再按「生效日期」筛选：只要配置了 active 方案就使用（个人优先，其次岗位模板）。
--
-- 需求：管理员配置方案后，任意周期都直接使用该方案，不再要求 effective_from <= 周期结束日。
-- 选取仍取最新一条：个人方案优先，其次 effective_from / version 最新；仅移除时间过滤条件。
-- 覆盖主播（salary_schemes）与主持（host_salary_schemes）。

create or replace function public._anchor_effective_scheme(
  p_profile_id uuid, p_position_id bigint, p_period_end date
)
returns public.salary_schemes language sql stable set search_path = '' as $$
  select * from public.salary_schemes
  where position_id = p_position_id
    and status = 'active'
    and (profile_id = p_profile_id or profile_id is null)
  order by (profile_id is not null) desc, effective_from desc, version desc, id
  limit 1;
$$;

create or replace function public._host_effective_scheme(
  p_profile_id uuid, p_period_end date
)
returns public.host_salary_schemes language sql stable set search_path = '' as $$
  select * from public.host_salary_schemes
  where status = 'active'
    and (profile_id = p_profile_id or profile_id is null)
  order by (profile_id is not null) desc, effective_from desc, version desc, id
  limit 1;
$$;
