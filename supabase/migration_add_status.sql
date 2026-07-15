-- ═══════════════════════════════════════════════════════
--  MMM Classroom Tools — migration
--  Run this once if you already ran an earlier version of
--  schema.sql (before the self-signup/approval workflow was
--  added). Safe to run even if some pieces already exist.
-- ═══════════════════════════════════════════════════════

-- 1. Add the missing status column
alter table public.profiles
    add column if not exists status text not null default 'pending';

alter table public.profiles
    drop constraint if exists profiles_status_check;

alter table public.profiles
    add constraint profiles_status_check check (status in ('pending','approved','rejected'));

-- 2. Make sure any existing admin rows count as approved
update public.profiles set status = 'approved' where role = 'admin';

-- 3. (Re)create the is_admin() helper
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles where id = auth.uid() and role = 'admin'
    );
$$;

-- 4. Make sure the self-signup + admin-manage policies exist
drop policy if exists "self signup as pending teacher" on public.profiles;
create policy "self signup as pending teacher" on public.profiles
    for insert with check (
        auth.uid() = id and role = 'teacher' and status = 'pending'
    );

drop policy if exists "admin manages all profiles" on public.profiles;
create policy "admin manages all profiles" on public.profiles
    for update using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "admin deletes profiles" on public.profiles;
create policy "admin deletes profiles" on public.profiles
    for delete using (public.is_admin());

-- 5. Trigger that blocks a non-admin from ever changing their own role/status
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        if new.role is distinct from old.role then
            raise exception 'Only an admin can change role';
        end if;
        if new.status is distinct from old.status then
            raise exception 'Only an admin can change status';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_profile_fields_trigger on public.profiles;
create trigger protect_profile_fields_trigger
    before update on public.profiles
    for each row execute function public.protect_profile_fields();

-- 6. Make sure the public class-code lookup only resolves approved teachers
create or replace function public.get_class_view(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher_id uuid;
    v_class_name text;
    result json;
begin
    select id, class_name into v_teacher_id, v_class_name
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher_id is null then
        return json_build_object('error', 'not_found');
    end if;

    select json_build_object(
        'class_name', v_class_name,
        'students', coalesce(json_agg(t order by t.position, t.name), '[]'::json)
    ) into result
    from (
        select
            s.name,
            s.position,
            (select r.test_date from public.score_records r
                where r.student_id = s.id order by r.test_date desc limit 1) as last_test_date,
            (select r.score from public.score_records r
                where r.student_id = s.id order by r.test_date desc limit 1) as last_score,
            (select count(*) from public.score_records r where r.student_id = s.id) as tests_taken,
            (select round(avg(r.score)::numeric, 1) from public.score_records r where r.student_id = s.id) as avg_score
        from public.students s
        where s.teacher_id = v_teacher_id
    ) t;

    return result;
end;
$$;

grant execute on function public.get_class_view(text) to anon, authenticated;
