-- 团队结算周期 + 四态薪资状态机（PLAN-001 阶段1）
--
-- 一、结算周期双模式（团队维度配置 settlement_type）：
--   monthly：自然月，周期 = 当月 1 号 → 当月最后一天；次月 1 号触发上一自然月结算。
--   custom ：锚点式，起始日 settlement_start_day(1~28)，周期 = 本月起始日 → 次月起始日前一天；
--            次月起始日触发上一周期结算。monthly 等价于 custom+start_day=1。
--   last_settled_period_end：已结算的上一周期末日，用于自动结算幂等去重。
--
-- 二、四态状态机（重建 salary_record_status）：
--   pending_review(待审核) → pending_confirm(待确认) → confirmed(已确认) → completed(已完成/终态)
--   - pending_review：下一周期第一天系统自动生成
--   - pending_review →(管理员通过)→ pending_confirm；审核驳回 → 原地重算并重置 pending_review
--   - pending_confirm →(成员确认)→ confirmed
--   - confirmed →(管理员确认到账)→ completed
--   除 completed 外其他状态可能多次出现（可重入）。
--
-- 三、时间戳双写：主表存 4 个最新时间戳字段便于列表展示；status_logs 表存完整轨迹（另一迁移）。

-- ---------- 结算周期枚举与团队配置 ----------
create type public.settlement_type as enum ('monthly', 'custom');

alter table public.teams
  add column settlement_type public.settlement_type not null default 'monthly',
  add column settlement_start_day integer not null default 1
    check (settlement_start_day between 1 and 28),
  add column last_settled_period_end date;

-- ---------- 重建四态薪资状态枚举 ----------
-- 现有 salary_record_status('draft','confirmed','published','voided') 与新四态无直接语义对应，
-- 采用「新建枚举 + 列改类型 + 旧值映射 + 丢弃旧枚举」的稳妥迁移。
create type public.salary_record_status_new as enum
  ('pending_review', 'pending_confirm', 'confirmed', 'completed');

-- 【重要】先删除所有引用 status 列/旧枚举值的策略，再改列类型与删除旧枚举，
-- 否则 alter column type / drop type 会因策略依赖旧枚举而失败。
drop policy if exists salary_records_select on public.salary_records;
drop policy if exists salary_records_update on public.salary_records;

-- 先去掉列默认值，避免 alter type 时默认值转换失败。
alter table public.salary_records alter column status drop default;

-- 旧值 → 新值映射：draft→pending_review；confirmed→pending_confirm；
-- published→confirmed；voided→pending_review（作废视为需重新处理）。
alter table public.salary_records
  alter column status type public.salary_record_status_new
  using (
    case status::text
      when 'draft' then 'pending_review'
      when 'confirmed' then 'pending_confirm'
      when 'published' then 'confirmed'
      when 'voided' then 'pending_review'
      else 'pending_review'
    end
  )::public.salary_record_status_new;

drop type public.salary_record_status;
alter type public.salary_record_status_new rename to salary_record_status;

alter table public.salary_records
  alter column status set default 'pending_review';

-- ---------- salary_records 扩列：团队 / 周期 / 四态时间戳 / 操作人 ----------
alter table public.salary_records
  add column team_id uuid references public.teams(id) on delete set null,
  add column period_start date,
  add column period_end date,
  add column review_pending_at timestamptz,
  add column confirm_pending_at timestamptz,
  add column confirmed_at timestamptz,
  add column completed_at timestamptz,
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column confirmed_by uuid references public.profiles(id) on delete set null,
  add column completed_by uuid references public.profiles(id) on delete set null;

create index salary_records_team_period_idx
  on public.salary_records(team_id, period_start desc);

-- ---------- RLS：成员可将己方 pending_confirm → confirmed（仅 status） ----------
-- 管理员全量可写（重建，因前面已 drop）。
create policy salary_records_update on public.salary_records for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 成员确认策略：仅允许己方 pending_confirm → confirmed。
create policy salary_records_member_confirm on public.salary_records for update to authenticated
  using (profile_id = public.current_profile_id() and status = 'pending_confirm')
  with check (profile_id = public.current_profile_id() and status = 'confirmed');

-- 【重要】RLS 只能限制行与 status 取值，无法限制「本次 UPDATE 改动了哪些列」。
-- 非管理员（成员）确认时可能顺带篡改金额等字段，故用触发器强制：非管理员更新时，
-- 除 status / confirmed_at / confirmed_by / updated_at 外的列必须保持不变。
create or replace function public.guard_salary_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.profile_id       is distinct from old.profile_id
     or new.position_id   is distinct from old.position_id
     or new.scheme_id     is distinct from old.scheme_id
     or new.month         is distinct from old.month
     or new.team_id       is distinct from old.team_id
     or new.period_start  is distinct from old.period_start
     or new.period_end    is distinct from old.period_end
     or new.revenue_cents is distinct from old.revenue_cents
     or new.tenure_month  is distinct from old.tenure_month
     or new.threshold_cents is distinct from old.threshold_cents
     or new.is_qualified  is distinct from old.is_qualified
     or new.is_grace_period is distinct from old.is_grace_period
     or new.guaranteed_component_cents is distinct from old.guaranteed_component_cents
     or new.performance_component_cents is distinct from old.performance_component_cents
     or new.gross_cents   is distinct from old.gross_cents
     or new.service_fee_cents is distinct from old.service_fee_cents
     or new.net_cents     is distinct from old.net_cents
     or new.commission_rate_bps is distinct from old.commission_rate_bps
  then
    raise exception '成员确认工资时不允许修改金额或结算相关字段';
  end if;
  return new;
end $$;

create trigger salary_records_member_update_guard
  before update on public.salary_records
  for each row execute function public.guard_salary_member_update();

-- 成员可读己方非 pending_review 记录（待审核为内部草稿，不对成员展示）。
create policy salary_records_select on public.salary_records for select to authenticated
  using (
    public.is_admin()
    or (profile_id = public.current_profile_id() and status <> 'pending_review')
  );