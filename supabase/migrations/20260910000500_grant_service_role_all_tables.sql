-- 修复：service_role 对 20260908085854 之后新建的表缺少基础 CRUD 权限。
-- 旧迁移 grant ... on all tables in schema public 仅覆盖当时已存在的表，
-- 导致 teams / team_members / team_performance_records / salary_record_status_logs /
-- notifications / performance_points 等后续表无 service_role 权限，
-- Edge Function（service_role 绕过 RLS）在结算时读取 teams 报 permission denied for table teams。
grant select, insert, update, delete on all tables in schema public to service_role;

-- 未来新建表自动授权（针对 postgres 与 authenticated 两个建表主体），
-- 避免后续新增表再次出现同类权限缺口。
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;