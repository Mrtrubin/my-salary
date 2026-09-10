# PLAN-001 团队结算周期自动薪资核算与发放确认

## 任务概述
为团队管理新增「结算周期」能力：管理员为团队设置结算周期（**自然月 / 自定义锚点式** 双模式）。**下一结算周期第一天开始时**，系统自动计算上一周期团队内主播流水对应薪水，生成工资条（状态=待审核）。管理员审核通过→待确认，成员确认→已确认，管理员确认工资到账→已完成。每次状态转换记录时间戳（展示精确到秒），除【已完成】外其他状态可能多次出现，需保留完整变更轨迹。

现状复用：`salary_records` 主表结构与主播工资计算器 [`calculateAnchorPayroll()`](lib/domain/payroll/anchor.ts:44)；`teams`/`team_members`/`team_performance_records` 已具备团队与流水结构。缺口：结算周期配置、按周期聚合流水、自动生成、四态状态机 + 状态历史、成员确认、管理员确认到账、工资条通知。

## 关键设计决策
- **四态状态机**（重定义 `salary_record_status`）：
  `pending_review`(待审核) → `pending_confirm`(待确认) → `confirmed`(已确认) → `completed`(已完成/终态)
  - 待审核：下一周期第一天系统自动生成
  - 待审核 →(管理员审核通过)→ 待确认；审核驳回 → 立刻按当前流水**重新计算并原地更新同一条记录**，重置为待审核（**状态可多次出现**，无需驳回原因）
  - 待确认 →(成员确认)→ 已确认
  - 已确认 →(管理员确认到账)→ 已完成
- **时间戳存储（双写）**：
  - 主表 `salary_records` 存 4 个最新时间戳字段（`review_pending_at`/`confirm_pending_at`/`confirmed_at`/`completed_at`）便于列表快速展示
  - 新表 `salary_record_status_logs` 存完整轨迹（每次转换插一条），支持某状态多次出现的回溯
- **结算周期双模式**（团队维度配置 `settlement_type`）：
  - `monthly`（自然月）：周期 = 自然月1 号 → 当月最后一天。下一周期第一天（次月 1 号）触发上一自然月结算。
  - `custom`（自定义/锚点式）：设起始日 `settlement_start_day`(1~28)，周期 = 「本月起始日 → 次月起始日前一天」。例：起始日=21 → 每月 21 日至次月 20 日。下一周期第一天（次月 21 日）触发上一周期(21→20)结算。
  - 统一抽象：`monthly` 等价于 `custom` 且 `start_day=1`；周期函数按 `settlement_type` 分支，`monthly` 忽略 `settlement_start_day`。
- 流水来源：聚合 `team_performance_records` 中 `approved` 且 `perf_date` 落在 [周期起, 周期止] 的 `revenue_cents`。
- 自动结算用 Supabase Edge Function + pg_cron，每日 00:05 扫描「当日=某团队周期第一天」的团队，对刚结束的上一周期结算。

---

## TODO: 阶段1 — 数据库迁移（周期 + 四态状态机 + 状态日志 + 通知）
- [ ] 新迁移 `2026xxxx_add_team_settlement.sql`：
  - [ ] 新增 enum `settlement_type`：`monthly`/`custom`
  - [ ] `teams` 增列：`settlement_type`(默认 monthly)、`settlement_start_day`(int 1~28, 默认 1, 仅 custom 生效)、`last_settled_period_end`(date, 已结算的上一周期末日, 幂等去重)
  - [ ] 重建 `salary_record_status` enum 为四态：`pending_review`/`pending_confirm`/`confirmed`/`completed`（迁移旧值映射）
  - [ ] `salary_records` 增列：`team_id`(uuid)、`period_start`(date)、`period_end`(date)、`review_pending_at`、`confirm_pending_at`、`confirmed_at`、`completed_at`(均 timestamptz)、`confirmed_by`(uuid)、`completed_by`(uuid)、`reviewed_by`(uuid)
- [ ] 新迁移 `2026xxxx_create_salary_status_logs.sql`：
  - [ ] `salary_record_status_logs` 表：`id`、`salary_record_id`、`from_status`、`to_status`、`operator_profile_id`、`created_at`(timestamptz, 精确到秒)
  - [ ] 触发器/或应用层：每次 `salary_records.status` 变更时插日志 + 同步更新主表对应最新时间戳字段
  - [ ] RLS：管理员全量读；成员读己方记录日志
- [ ] 新迁移 `2026xxxx_create_notifications.sql`：`notifications` 表(`profile_id`/`type`/`title`/`body`/`ref_id`/`read_at`/`created_at`)；RLS 成员读/标记己方，service_role 写
- [ ] 更新 `salary_records` RLS：成员可将己方 `pending_confirm` → `confirmed`（仅 status）
- [ ] 重新生成 [`database.types.ts`](lib/supabase/database.types.ts)

## TODO: 阶段2 — 结算周期领域逻辑（纯函数，可测）
- [ ] `lib/domain/settlement/cycle.ts`：按 `settlement_type` 分支。`isPeriodFirstDay(type, startDay, date)`、`getPreviousPeriodRange(type, startDay, date)`(返回刚结束周期的 [起,止])、`getPeriodRange(type, startDay, date)`。monthly=自然月边界，custom=锚点式边界
- [ ] `lib/domain/settlement/aggregate.ts`：按 team + period 聚合成员流水 → 调用 [`calculateAnchorPayroll()`](lib/domain/payroll/anchor.ts:44) → 产出 salary_record 草稿数据(含 period_start/end)
- [ ] 单测：`tests/settlement-cycle.test.ts`（monthly 大小月/闰月月末；custom 起始日 21/28；两模式跨年边界）
- [ ] 验证点：`pnpm test` 通过后再进入阶段3

## TODO: 阶段3 — 自动结算 Edge Function
- [ ] `supabase/functions/settle-team-payroll/index.ts`：service_role 扫描当日=周期第一天且 `last_settled_period_end` != 上一周期末日的团队，聚合上一周期流水，批量 upsert `salary_records`(status=pending_review, team_id, period_start/end)，写状态日志，更新 `last_settled_period_end`
- [ ] pg_cron 每日 00:05 调用（迁移中 `cron.schedule`）
- [ ] 管理员手动触发入口（前端“立即结算”→ 同函数带 teamId + period）

## TODO: 阶段4 — 团队周期配置 + 管理端审核 → 确认到账（✅ 已完成）
- [ ] 团队管理页/详情：结算周期配置 UI（选 monthly / custom；custom 时选起始日 1~28），保存到 `teams`
- [ ] data 层 `transitionSalaryStatus(id, toStatus, {operator})`：校验合法转换、更新主表 status + 对应时间戳、插状态日志；审核通过时给成员发 `notifications`(payslip_pending)
- [ ] data 层 `rejectAndRecompute(id, {operator})`：驳回 → 重新聚合当前周期流水、重算金额、原地更新同一条记录并重置为待审核、插日志（from=pending_review, to=pending_review）
- [ ] `admin/payroll/page.tsx`：按团队/周期分组；操作：待审核→通过(待确认)/驳回(重算后仍待审核)、已确认→确认到账(已完成)；每行可展开查看四态时间戳(精确到秒)
- [ ] hooks：替换 `useUpdateSalaryStatus` 为四态转换；`useUpdateTeam` 增加周期字段

## TODO: 阶段5 — 成员确认 + 工资条通知 + 状态时间轴（✅ 已完成）
- [x] data 层 `confirmSalaryRecord(id)`：成员 `pending_confirm`→`confirmed`，更新 `confirmed_at`/`confirmed_by` + 插日志
- [x] `user/payslips/page.tsx`：状态 badge(四态) + 待确认时显示「确认收款」按钮 + 状态时间轴(读 status_logs, 精确到秒)
- [x] 通知入口：user layout 铃铛/红点，`useNotifications` + 标记已读
- [ ] 验证点：端到端演示 自动生成(待审核)→审核(待确认)→成员确认(已确认)→到账(已完成)，含一次驳回重走

## 文档 / 注释要求
- 迁移文件顶部注释说明四态状态机、可重入状态、双写时间戳规则
- 领域函数补 JSDoc，标注周期计算与边界

---

## 待确认点（建议 quick validation）
1. **custom 起始日 > 28（29/30/31）**：是否需支持？当前限制 1~28 规避月末天数差异（monthly 模式不受此限）。
> 不支持
2. **通知方式**：仅站内通知，还是需短信/邮件？
> 站内通知
3. **周期止日流水归属**：周期止日当天流水计入本周期（含当日），下一周期从次日起——确认无误？
> 本周期