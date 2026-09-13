-- 团队唯一标识 team_key:
-- 管理员创建团队时输入,创建后不可修改。用于团队的对外/对内唯一编号,展示在团队列表与详情。
--
-- 步骤:
--   1. 先加可空列;
--   2. 回填历史数据(用 id 文本兜底,保证唯一且非空);
--   3. 置 not null + 唯一约束 + 非空校验;
--   4. 触发器兜底:禁止 update 修改 team_key(应用层也不下发该字段)。

-- 1. 新增可空列。
alter table public.teams add column if not exists team_key text;

-- 2. 回填历史团队:无 key 的用其 id 文本兜底。
update public.teams set team_key = id::text where team_key is null;

-- 3. 约束:非空 + 去空白非空 + 全局唯一。
alter table public.teams alter column team_key set not null;
alter table public.teams add constraint teams_team_key_not_blank check (length(trim(team_key)) > 0);
alter table public.teams add constraint teams_team_key_key unique (team_key);

-- 4. 触发器:team_key 一经创建不可修改。
create or replace function public.forbid_team_key_update()
returns trigger language plpgsql as $$
begin
  if new.team_key is distinct from old.team_key then
    raise exception 'team_key is immutable and cannot be changed';
  end if;
  return new;
end;
$$;

create trigger teams_forbid_team_key_update
  before update on public.teams
  for each row execute function public.forbid_team_key_update();