-- 修复：submit-password-change / review-profile-change 以 service_role 运行时
-- 对 profile_change_requests 执行 update/insert 报 "permission denied for table"。
-- 根因：建表迁移仅 grant 给 authenticated，未显式授予 service_role；
-- 当默认权限（default privileges）未覆盖到该表时，service_role 缺少表级权限，
-- 且 PostgREST 在 UPDATE 命中 0 行时也会做权限检查，故首次提交即失败。
-- 处理：显式将该表全部 DML 权限授予 service_role（幂等，可安全重复执行）。

grant select, insert, update, delete on public.profile_change_requests to service_role;