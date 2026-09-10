-- 工资方案「岗位模板」机制：profile_id 为空表示该岗位的共享默认模板，
-- 成员无个人方案时回退使用。此处为「主播」岗位(id=2)预置一份模板。
-- 匹配规则见 settle-team-payroll Edge Function 的 resolveScheme：
--   个人方案(profile_id 匹配) 优先，否则回退 profile_id 为空的同岗位模板。

insert into public.salary_schemes (
  profile_id, position_id, name, version,
  base_salary_cents, guaranteed_salary_cents, threshold_multiplier_bps, commission_rate_bps,
  effective_from, status
)
values (null, 2, '主播模板', 1, 800000, 500000, 26500, 2000, '2026-01-01', 'active')
on conflict (name, version) do nothing;