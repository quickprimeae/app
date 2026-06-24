-- db/migrations/0019_employee_code_qp_to_op.sql

create or replace function public.generate_employee_number()
returns trigger
language plpgsql
as $function$
begin
  if new.employee_number is null or new.employee_number = '' then
    new.employee_number :=
      'OP-' || lpad(nextval('employee_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$function$;

update public.employees
set employee_number = 'OP-' || substr(employee_number, 4)
where employee_number like 'QP-%';
