-- 个税仅保留「工资核算手动输入」，移除个税管理相关的表与自动计算函数。

drop function if exists public.apply_income_tax(uuid, date, bigint);
drop function if exists public.cumulative_income_tax_cents(bigint);
drop table if exists public.income_tax_records;
