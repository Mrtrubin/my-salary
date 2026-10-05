-- 主持人上传主播业绩：无绩效备注默认文案「停播」调整为「休息」。
--
-- 主持人勾选「休息」（原「停播」）时，前端把 no_perf_note 落库到
-- anchor_revenue_records；此处回填历史数据中的旧默认值，成员自定义的备注保持不变。
-- 幂等：仅命中 no_perf=true 且文案恰为「停播」的记录。

update public.anchor_revenue_records
set no_perf_note = '休息',
    updated_at = now()
where no_perf = true
  and no_perf_note = '停播';
