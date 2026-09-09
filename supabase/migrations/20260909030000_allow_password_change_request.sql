-- 扩展资料修改申请以支持「修改密码」审核。
-- 密码属敏感数据：明文绝不落库。提交时新密码由 Edge Function 用服务端密钥（CHANGE_REQUEST_SECRET）
-- AES-GCM 加密后写入 secret_value；new_value/old_value 对 password 均不存明文（仅占位脱敏）。
-- 审核通过时由 review-profile-change 解密 secret_value 后调用 auth.admin.updateUserById 落库到 Auth。

-- 放开 field 约束，加入 password。
alter table public.profile_change_requests drop constraint profile_change_requests_field_check;
alter table public.profile_change_requests
  add constraint profile_change_requests_field_check
  check (field in ('name', 'phone', 'email', 'id_card', 'password'));

-- 新增密文列：仅 password 类申请使用，存 AES-GCM 密文（iv:cipher，base64）。
alter table public.profile_change_requests add column secret_value text;

comment on column public.profile_change_requests.secret_value is
  '密码类申请的加密新密码（AES-GCM，base64，格式 iv:cipher）；非密码类为 null。';