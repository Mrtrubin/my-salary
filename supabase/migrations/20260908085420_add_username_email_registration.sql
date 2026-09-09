-- 用户名登录与自助注册：profiles 增加唯一用户名与选填联系邮箱。
-- 注册账号统一经 auth-register Edge Function（service role）写入，
-- 普通客户端仍不可直接 insert profiles（RLS 策略保持不变）。

alter table public.profiles
  add column if not exists username text,
  add column if not exists email text;

alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_-]{3,32}$');

create unique index if not exists profiles_username_key
  on public.profiles (username)
  where username is not null;

create unique index if not exists profiles_email_key
  on public.profiles (lower(email))
  where email is not null and email <> '';
