-- 主播每日流水：持久化「逐条调整项」（名称 + 数值，单位与业绩一致，可为负）。
--
-- 背景：此前只有 adjustment_cents（折算后的金额），无法还原「运营票 +100、罚款 -50」这类明细，
-- 也没法在编辑回填时把调整项与业绩分开。这里新增 jsonb 存逐条明细，形如：
--   [{"name":"运营票","amount":100},{"name":"罚款","amount":-50}]
-- 历史记录默认空数组；金额折算仍以 adjustment_cents 为准，本字段仅用于展示与回填。
--
-- 与 adjustment_cents 的关系：adjustment_cents = round(sum(amount) / 换算率 × 100)。
alter table public.anchor_revenue_records
  add column if not exists adjustments jsonb not null default '[]'::jsonb;

comment on column public.anchor_revenue_records.adjustments is
  '当日逐条调整项（名称 + 数值，单位与业绩一致，可为负）；金额折算以 adjustment_cents 为准。';
