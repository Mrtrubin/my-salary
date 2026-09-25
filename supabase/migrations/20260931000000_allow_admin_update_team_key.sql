-- team_key 由「创建后不可修改」改为「管理员可修改」。
-- 背景:20260924000000_add_team_key.sql 用触发器一刀切禁止 update team_key,
--   管理员也无法纠正录错的 Key。产品口径调整为:仅管理员可改,非管理员不可改。
--
-- 改后的完整性/权限保障:
--   1. 约束保留:teams_team_key_not_blank(去空白非空) + teams_team_key_key(全局唯一),
--      修改后依然非空且唯一,应用层把唯一冲突(23505)提示为「团队 Key 已存在」;
--   2. 权限收敛在 RLS:teams_update 策略 using/with check 均为 public.is_admin(),
--      主持人等非管理员更新会被策略拦掉(影响 0 行),故「只有管理员能改」由 RLS 保证;
--   3. 不再需要触发器兜底,一并删除函数,避免只删触发器留下悬空函数。
--
-- 注意:team_key 同时是外部拉取主播流水时使用的 anchorId(见 daily-income Edge Function),
--   修改后新值立即生效,历史流水按 team_id 关联,不受影响。

drop trigger if exists teams_forbid_team_key_update on public.teams;
drop function if exists public.forbid_team_key_update();
