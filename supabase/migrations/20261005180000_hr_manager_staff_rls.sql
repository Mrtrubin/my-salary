-- 人事主管可读取「人事」角色的工资条（生成后查看状态）。

create policy staff_salary_records_hr_manager_select
  on public.staff_salary_records for select to authenticated
  using (
    public.is_hr_manager()
    and exists (
      select 1 from public.roles r
      where r.id = staff_salary_records.role_id and r.code = 'hr'
    )
  );

notify pgrst, 'reload schema';
