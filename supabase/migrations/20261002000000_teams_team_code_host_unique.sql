-- 团队 ID 的唯一性口径收敛为「(团队 ID, 主持人) 组合唯一」。
--
-- 口径：
--   * 已放开：teams.team_code 的**全局**唯一约束在 20261001000000 已移除；
--   * 本次收紧：同一个主持人（host_profile_id）名下不允许出现两个相同团队 ID 的团，
--     不同主持人之间仍可共用同一个团队 ID；
--   * 团队名称、主持人本身都允许重复（20260927000000 / 20260929000000 已放开）。
--
-- 为什么是组合唯一：一个主持人可以带多个团，这些团的团队 ID 必须能区分开，
-- 否则该主持在「上传绩效」里选团、以及按 ID 反查时会分不清是哪个团；
-- 而 ID 本身是外部流水上游的 anchor_id，跨主持复用在业务上是合法的。
--
-- 注意：若历史数据已存在「同一主持 + 同一团队 ID」的重复行，本迁移会失败并报
--   could not create unique index ... Key (team_code, host_profile_id)=(..., ...) is duplicated
--   需要先人工合并/改号这些团再重跑。
--
-- 索引顺序取 (team_code, host_profile_id)：既能支撑组合唯一校验，
-- 也能继续支撑 daily-income 按 team_code 兜底定位（最左前缀可用）。

alter table public.teams
  add constraint teams_team_code_host_profile_id_key unique (team_code, host_profile_id);
