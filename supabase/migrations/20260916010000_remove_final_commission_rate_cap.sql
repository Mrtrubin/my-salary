-- 仅阶梯提点封顶 5%；最终提成率没有业务上限。
-- 工资快照保留非负约束，移除原有 100% 上限；不重算历史记录。
alter table public.salary_records
  drop constraint salary_records_commission_rate_bps_check,
  add constraint salary_records_commission_rate_bps_check
    check (commission_rate_bps >= 0);

comment on column public.salary_records.commission_rate_bps is '本次最终提成费率快照（基点，非负且无业务上限）；仅阶梯加点封顶 500 bps';