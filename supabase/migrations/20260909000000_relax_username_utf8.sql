-- 放开用户名约束以支持 UTF-8（含中文）用户名。
-- 背景：管理员新增成员时用户名必填且允许 UTF-8；登录邮箱不再由用户名拼接，
-- 改由固定前缀 + 随机串生成的合成邮箱（见 admin-create-member Edge Function），
-- 因此用户名仅作展示与唯一标识，不再受邮箱本地部分字符集限制。

-- 移除旧的 ASCII 格式约束
alter table public.profiles
  drop constraint if exists profiles_username_format;

-- 新约束：用户名去除首尾空白后长度需为 1-32 个字符（允许任意 UTF-8 字符）
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or (length(trim(username)) between 1 and 32));

-- 唯一索引已在此前迁移创建（profiles_username_key），此处无需重复创建。