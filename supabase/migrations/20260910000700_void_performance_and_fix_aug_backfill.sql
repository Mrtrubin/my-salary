-- 团队业绩作废（voided）+ 补录 8 月业绩相关数据修复。
--
-- 1) performance_status 枚举新增 voided：主持人补提交/重复上传时，旧业绩标记作废（前端删除线），不再计入结算。
-- 2) 数据修复（水晶之恋团队，补录 8 月业绩但成员 9 月才入组的时序矛盾）：
--    - 成员入组/入职日期回填到 8 月，使 8 月业绩可结算；
--    - 每日业绩只保留最新一条，旧的重复记录标记 voided；
--    - 重置异常推进到未来的结算游标。

alter type public.performance_status add value if not exists 'voided';

-- 数据修复：同一成员同一日期多条 approved 业绩，仅保留 updated_at 最新的一条，
-- 其余标记 voided（作废）。这里针对水晶之恋团队；逻辑为通用「每日只取最新」。
with ranked as (
  select
    id,
    row_number() over (
      partition by team_id, profile_id, perf_date
      order by updated_at desc, created_at desc
    ) as rn
  from public.team_performance_records
  where team_id = '2d74a3cd-2ce0-48f5-9a67-0393ebf7bfd9'
    and status = 'approved'
)
update public.team_performance_records t
set status = 'voided',
    updated_at = now()
from ranked r
where t.id = r.id and r.rn > 1;

-- 数据修复：将这 8 位成员入组/入职日期回填到 8 月（业绩所在周期），
-- 使 8 月周期结算时能被 loadMembers 判定为在组。
update public.team_members
set joined_at = '2026-08-31'
where team_id = '2d74a3cd-2ce0-48f5-9a67-0393ebf7bfd9'
  and joined_at = '2026-09-10';

update public.profiles
set hire_date = '2026-08-31'
where id in (
  select profile_id from public.team_members
  where team_id = '2d74a3cd-2ce0-48f5-9a67-0393ebf7bfd9'
)
and hire_date = '2026-09-10';

-- 数据修复：重置被异常推进到未来的结算游标（last_settled_period_end = 2026-09-30）。
update public.teams
set last_settled_period_end = null
where id = '2d74a3cd-2ce0-48f5-9a67-0393ebf7bfd9'
  and last_settled_period_end = '2026-09-30';