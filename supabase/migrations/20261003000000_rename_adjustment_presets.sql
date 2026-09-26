-- 调整项预设文案调整：迟到 → 延误，缺勤 → 停播。
--
-- 预设名称由前端（getAdjustmentPresets）生成，并随结算快照原样落库到
-- salary_records.adjustments(JSONB)。前端文案改名后，历史快照仍是旧名称，
-- 这里回填已保存的旧名称，保证成员端工资条与最新文案一致。
-- 幂等：仅命中仍含旧名称的记录，重复执行无副作用。
--
-- salary_records 上有 guard_salary_member_update 触发器，只允许成员把
-- pending_confirm 改成 confirmed（其余一律 42501）。数据回填属于系统级修复，
-- 需在事务内临时停用该守卫，结束后恢复（DDL 事务性，失败会整体回滚）。

alter table public.salary_records disable trigger salary_records_member_update_guard;

update public.salary_records
set adjustments = (
  select jsonb_agg(
    jsonb_set(
      elem,
      '{name}',
      to_jsonb(
        case elem->>'name'
          when '迟到' then '延误'
          when '缺勤' then '停播'
          else elem->>'name'
        end
      )
    )
    order by ord
  )
  from jsonb_array_elements(adjustments) with ordinality as t(elem, ord)
)
where adjustments @> '[{"name":"迟到"}]'::jsonb
   or adjustments @> '[{"name":"缺勤"}]'::jsonb;

alter table public.salary_records enable trigger salary_records_member_update_guard;
