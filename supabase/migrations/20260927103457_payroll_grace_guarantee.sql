-- 修正主播「保底金额」口径：无责期保底保护。
-- 背景：原口径按「当月是否达标」取保底（达标→初始保底，不达标→降级保底），
--   导致处于无责期（入职前 3 个月）的主播在未达标时也被降级为降级保底，
--   与「无责期」的保底保护语义相悖（无责期应始终按初始保底）。
--
-- 新口径（与 lib/domain/payroll/anchor.ts、settle-team-payroll/payroll.ts 完全一致）：
--   is_grace_period（前 3 个月）或 is_qualified（当月达标）→ 初始保底；
--   否则（非无责期且当月不达标）→ 降级保底。
-- 门槛、达标判定、提成起征、提成互斥、服务费等其余口径均不变。
begin;

create or replace function public._anchor_compute_payroll(
  p_base_salary_cents bigint,
  p_guaranteed_salary_cents bigint,
  p_threshold_multiplier_bps integer,
  p_monthly_revenue_cents bigint,
  p_tenure_month integer,
  p_base_commission_rate_bps integer,
  p_attendance_bonus_bps integer,
  p_dy_task_bonus_bps integer,
  p_adjustment_total_cents bigint,
  p_service_fee_rate_bps integer default 300
)
returns public.anchor_payroll_detail language plpgsql immutable set search_path = '' as $$
declare
  r public.anchor_payroll_detail;
  v_steps integer;
  v_capped_steps integer;
  v_gross_before bigint;
begin
  -- 基本合法性校验（对齐 anchor.ts validateInput）。
  if p_attendance_bonus_bps < 0 or p_attendance_bonus_bps > 2147483647
     or p_dy_task_bonus_bps < 0 or p_dy_task_bonus_bps > 2147483647 then
    raise exception 'INVALID_COMMISSION_BPS:bonus' using errcode = '22023';
  end if;
  if p_base_commission_rate_bps is null or p_base_commission_rate_bps <= 0
     or p_base_commission_rate_bps > 10000 then
    raise exception 'INVALID_COMMISSION_BPS:baseCommissionRateBps' using errcode = '22023';
  end if;
  if p_tenure_month < 1 then
    raise exception 'INVALID_SETTLEMENT_TENURE' using errcode = '22023';
  end if;

  -- 门槛固定用初始保底 × 系数，向上取整到分。
  r.threshold_cents := public._payroll_rate_ceil(p_base_salary_cents, p_threshold_multiplier_bps);
  -- 达标按当月流水。
  r.is_qualified := p_monthly_revenue_cents >= r.threshold_cents;
  -- 无责期：前 3 个月。
  r.is_grace_period := p_tenure_month between 1 and 3;
  -- 保底基准：无责期一律初始保底（保底保护）；非无责期按当月达标，达标初始、不达标降级。
  r.base_guarantee_cents := case when r.is_grace_period or r.is_qualified
    then p_base_salary_cents else p_guaranteed_salary_cents end;
  -- 起征 = 初始保底 × 5。
  r.commission_start_cents := p_base_salary_cents * 5;

  -- 阶梯提成：仅当流水 >= 起征才计提。
  if p_monthly_revenue_cents >= r.commission_start_cents then
    v_steps := greatest(0,
      floor((p_monthly_revenue_cents - r.commission_start_cents) / 1000000)::integer);
    v_capped_steps := least(v_steps, 5);
    -- 最终费率 = 基础 + 阶梯加点 + 考勤 + dy，用 numeric 防溢出再校验。
    if (p_base_commission_rate_bps::numeric + v_capped_steps * 100
        + p_attendance_bonus_bps + p_dy_task_bonus_bps) > 2147483647 then
      raise exception 'COMMISSION_RATE_OVERFLOW' using errcode = '22003';
    end if;
    r.commission_rate_bps := p_base_commission_rate_bps + v_capped_steps * 100
      + p_attendance_bonus_bps + p_dy_task_bonus_bps;
  else
    r.commission_rate_bps := 0;
  end if;

  -- 提成互斥：费率>0 走提成模式，否则走保底模式。
  if r.commission_rate_bps > 0 then
    r.performance_component_cents := public._payroll_rate_floor(
      p_monthly_revenue_cents, r.commission_rate_bps);
    r.guaranteed_component_cents := 0;
  else
    r.performance_component_cents := 0;
    r.guaranteed_component_cents := r.base_guarantee_cents;
  end if;

  -- 调整项叠加在总工资之上，服务费按含调整项的总工资重算。
  v_gross_before := r.guaranteed_component_cents + r.performance_component_cents;
  r.gross_cents := v_gross_before + p_adjustment_total_cents;
  r.service_fee_cents := public._payroll_rate_ceil(r.gross_cents, p_service_fee_rate_bps);
  r.net_cents := r.gross_cents - r.service_fee_cents;
  return r;
end $$;

commit;
