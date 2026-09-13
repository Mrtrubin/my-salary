-- 艺名重构:删除独立 stage_names 表,抖音号(douyin_id)并入主播档案 profiles。
-- 背景:艺名/抖音号是主播个人属性,不应与账号解耦为独立映射表。
--   1. profiles 新增 douyin_id 列(可空,唯一);
--   2. 按 stage_names.name = profiles.name 尽力回填历史抖音号;
--   3. drop stage_names 表及其触发器/函数/RLS。

-- ---------- 1. profiles 新增 douyin_id(可空、唯一) ----------
alter table public.profiles
  add column if not exists douyin_id text;

-- 唯一约束:允许多行 NULL(Postgres 唯一索引对 NULL 不去重),非空值全局唯一。
create unique index if not exists profiles_douyin_id_key
  on public.profiles(douyin_id)
  where douyin_id is not null;

-- ---------- 2. 尽力回填历史数据(按显示姓名匹配) ----------
-- stage_names 与 profiles 无外键关联,仅能按 name 匹配;冲突时保留最早创建的一条。
update public.profiles p
set douyin_id = s.douyin_id,
    updated_at = now()
from (
  select distinct on (name) name, douyin_id
  from public.stage_names
  order by name, created_at asc
) s
where p.name = s.name
  and p.douyin_id is null;

-- ---------- 3. drop stage_names 表及其附属对象 ----------
drop trigger if exists stage_names_set_updated_at on public.stage_names;
drop table if exists public.stage_names;
drop function if exists public.touch_stage_names_updated_at();