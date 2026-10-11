-- 主播首页「每日调整项」只读 RPC。
--
-- 目的：让主播本人在首页看到本期（进行中）与自己有关的**所有**调整项，不论由谁登记
-- （舞蹈老师 / 化妆师 / 主持），不必等结算。
--
-- 背景：四类调整项分散在三张表，且主播本人对其中的舞蹈 / 化妆两源无读权限：
--   * anchor_adjustment_records —— 舞蹈老师「补助 / 延误」等，金额口径（amount_cents 已是分）；
--     RLS 仅 is_admin / is_dance / is_makeup，主播读不到。
--   * anchor_delay_records —— 化妆师登记的「延误」标记，**只有布尔没有金额**；
--     RLS 仅 is_admin / is_makeup，主播读不到。
--   * anchor_revenue_records.adjustments —— 主持上传的调整项，主播本人可读，但
--     **单位是「绩效点」而不是金额**。
--   * anchor_revenue_records 的 no_perf + 备注「停播」—— 主持把停播记为无绩效记录而非调整项，
--     其扣款只在结算时产生。
--
-- 因此用一个 security definer 只读函数把上述来源统一成
-- 「某日 + 名称 + 有符号金额（分）+ 来源 + 备注 + 登记人」，**不改任何 RLS 策略、不加表**。
--
-- 身份：过滤条件恒为 anchor_profile_id = public.current_profile_id()，**不接受任何身份入参**，
-- 主播不可能读到他人数据。
--
-- 金额口径（一律折算为「分」，与结算尽量同源）：
--   1. 舞蹈：anchor_adjustment_records.amount_cents —— 已是分，原样透出（source 原样透传）。
--   2. 化妆「延误」：按当前生效方案的「初始保底」折算 -round(保底 / 260)，
--      与 lib/domain/payroll/adjustment.ts 的 delayDeductionCents() 同口径。
--   3. 主持调整项：amount 是绩效点，按该行绩效点的 points_per_yuan 折算
--      round(点数 × 100 ÷ points_per_yuan)，与主持端上传时的折算口径一致
--      （app/(user)/user/performance/upload/TeamUpload.tsx 的 adjustmentCents 计算）。
--      ⚠️ 逐条折算之和与当日 adjustment_cents 合计可能有 ±1 分差异（四舍五入位置不同）。
--   4. 主持「停播」：按 -round(初始保底 / 26) 折算，与 lib/domain/payroll/adjustment.ts 的
--      getAdjustmentPresets() 里「停播」预设同口径。
--
-- ⚠️ 维护提示：本函数的来源是**硬编码清单**。新增第四类调整项来源时必须同步改这里，
-- 否则主播端会**静默漏掉**该来源。另：anchor_adjustment_records 是「承载主持 / 化妆师 /
-- 舞蹈老师」的统一表，故第 1 段不按 source 过滤；若将来化妆师改把「延误」写进该表而
-- anchor_delay_records 仍在写，会与第 2 段重复计算，届时应二选一。

create or replace function public.list_my_anchor_adjustments(
  p_start date default null,
  p_end date default null
)
returns table(
  adjust_date date,
  name text,
  amount_cents bigint,
  source text,
  note text,
  registered_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select public.current_profile_id() as profile_id
  ),
  anchor_role as (
    select r.id as role_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join me on me.profile_id = ur.profile_id
    where r.code = 'anchor'
    limit 1
  ),
  base as (
    select coalesce(
      (public._anchor_effective_scheme(
        (select profile_id from me),
        (select role_id from anchor_role),
        current_date
      )).base_salary_cents,
      0
    )::bigint as base_salary_cents
  )

  -- 1) 舞蹈老师（统一调整项表，金额已是分）
  select a.adjust_date, a.name, a.amount_cents, a.source, a.note, r.name as registered_name
  from public.anchor_adjustment_records a
  left join public.profiles r on r.id = a.registered_by
  where a.anchor_profile_id = (select profile_id from me)
    and (p_start is null or a.adjust_date >= p_start)
    and (p_end is null or a.adjust_date <= p_end)

  union all

  -- 2) 化妆师「延误」（布尔 → 按当前初始保底折算）
  select d.delay_date, '延误'::text,
         (-round(b.base_salary_cents::numeric / 260))::bigint,
         'makeup'::text, d.note, r.name as registered_name
  from public.anchor_delay_records d
  cross join base b
  left join public.profiles r on r.id = d.registered_by
  where d.anchor_profile_id = (select profile_id from me)
    and d.is_delayed
    and b.base_salary_cents > 0
    and (p_start is null or d.delay_date >= p_start)
    and (p_end is null or d.delay_date <= p_end)

  union all

  -- 3) 主持上传的调整项（绩效点 → 分）
  select r.perf_date, btrim(it.item->>'name'),
         round((it.item->>'amount')::numeric * 100 / pp.points_per_yuan)::bigint,
         'host'::text, null::text, h.name as registered_name
  from public.anchor_revenue_records r
  join public.performance_points pp on pp.id = r.point_id
  left join public.profiles h on h.id = r.host_profile_id
  cross join lateral jsonb_array_elements(coalesce(r.adjustments, '[]'::jsonb)) as it(item)
  where r.profile_id = (select profile_id from me)
    and r.no_perf is not true
    and pp.points_per_yuan > 0
    and jsonb_typeof(it.item) = 'object'
    and jsonb_typeof(it.item->'amount') = 'number'
    and (it.item->>'amount')::numeric <> 0
    and nullif(btrim(coalesce(it.item->>'name', '')), '') is not null
    and (p_start is null or r.perf_date >= p_start)
    and (p_end is null or r.perf_date <= p_end)

  union all

  -- 4) 主持「停播」（no_perf + 备注「停播」→ 按初始保底 / 26 折算）
  select r.perf_date, '停播'::text,
         (-round(b.base_salary_cents::numeric / 26))::bigint,
         'host'::text, null::text, h.name as registered_name
  from public.anchor_revenue_records r
  cross join base b
  left join public.profiles h on h.id = r.host_profile_id
  where r.profile_id = (select profile_id from me)
    and r.no_perf
    and btrim(coalesce(r.no_perf_note, '')) = '停播'
    and b.base_salary_cents > 0
    and (p_start is null or r.perf_date >= p_start)
    and (p_end is null or r.perf_date <= p_end)

  order by adjust_date desc, name;
$$;

revoke all on function public.list_my_anchor_adjustments(date, date) from public, anon;
grant execute on function public.list_my_anchor_adjustments(date, date) to authenticated;

notify pgrst, 'reload schema';
