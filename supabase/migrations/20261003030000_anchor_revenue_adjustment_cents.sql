-- 主播流水记录增加「当日调整项」（金额，分）。
--
-- 上传时「调整项」原先是并入 points_amount / revenue_cents 的，无法还原，
-- 这里单独存调整项折算后的金额（可正可负），用于流水历史展示：
--   当日最终流水 = revenue_cents
--   当日调整项   = adjustment_cents
--   当日流水     = revenue_cents - adjustment_cents
-- 历史记录无法还原，默认 0（当日流水 = 最终流水）。

alter table public.anchor_revenue_records
  add column if not exists adjustment_cents bigint not null default 0;
