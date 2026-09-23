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
-- stage_names 与 profiles 无外键关联,仅能按 name 匹配。历史数据存在两类脏情况:
--   a) 同一 douyin_id 被多个 name 使用;b) 同一 name 对应多行 profile(重名)。
-- 因此按 douyin_id 精确定位到「唯一一行 profile」回填,确保每个抖音号只落一行,
-- 且跳过已被占用的抖音号,避免违反 profiles_douyin_id_key 唯一约束。
with candidate as (
  -- 每个 name 取最早创建的一条 stage_names
  select distinct on (name) name, douyin_id
  from public.stage_names
  where douyin_id is not null
  order by name, created_at asc
),
-- name -> profile 的匹配对,同一 douyin_id 只保留一个目标 profile
matched as (
  select
    p.id as profile_id,
    c.douyin_id,
    row_number() over (partition by c.douyin_id order by p.created_at asc) as rn
  from public.profiles p
  join candidate c on c.name = p.name
  where p.douyin_id is null
    -- 跳过已被任意 profile 占用的抖音号(含手动录入的真实数据)
    and not exists (
      select 1 from public.profiles p2 where p2.douyin_id = c.douyin_id
    )
)
update public.profiles p
set douyin_id = m.douyin_id,
    updated_at = now()
from matched m
where p.id = m.profile_id
  and m.rn = 1;

-- ---------- 3. drop stage_names 表及其附属对象 ----------
drop trigger if exists stage_names_set_updated_at on public.stage_names;
drop table if exists public.stage_names;
drop function if exists public.touch_stage_names_updated_at();