-- 成员资料增加身份证号（选填）。
-- 仅作资料留存，不做格式强校验（允许空）；如需唯一性可后续按业务补充。

alter table public.profiles
  add column if not exists id_card text;