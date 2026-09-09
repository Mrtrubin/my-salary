-- Edge Functions（service role）需要基础 CRUD 以执行注册等可信端操作。
-- service_role 天然绕过 RLS，此处仅补齐表权限，授权面不变（不含 sequences，profiles 用 uuid 无需）。

grant select, insert, update, delete on all tables in schema public to service_role;
