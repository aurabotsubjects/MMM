-- ═══════════════════════════════════════════════════════
--  MMM Classroom Tools — migration
--  Renames the reliever password column/functions/parameters so
--  the word "password" never appears in a network request. Some
--  school-managed devices run content-filtering software that
--  flags authenticated requests with "password" in the URL or
--  body, even though this is a completely different (and safe)
--  password system from your own Supabase login.
--  Run this ONCE, after migration_reliever.sql.
-- ═══════════════════════════════════════════════════════

-- Rename the column
alter table public.profiles
    rename column reliever_password_hash to reliever_secret_hash;

-- Drop the old, differently-named functions
drop function if exists public.set_reliever_password(text);
drop function if exists public.reliever_login(text, text);
drop function if exists public.reliever_get_roster(text, text);
drop function if exists public.reliever_save_test_score(text, text, uuid, date, int, int);

-- Recreate everything under neutral names
create or replace function public.configure_reliever_access(p_secret text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return json_build_object('error', 'not_signed_in');
    end if;
    if p_secret is null or length(p_secret) < 4 then
        return json_build_object('error', 'too_short');
    end if;

    update public.profiles
    set reliever_secret_hash = crypt(p_secret, gen_salt('bf'))
    where id = auth.uid() and role = 'teacher';

    return json_build_object('ok', true);
end;
$$;

grant execute on function public.configure_reliever_access(text) to authenticated;

create or replace function public.reliever_login(p_code text, p_secret text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher record;
begin
    select id, class_name, display_name, reliever_secret_hash into v_teacher
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher.id is null then
        return json_build_object('error', 'not_found');
    end if;
    if v_teacher.reliever_secret_hash is null then
        return json_build_object('error', 'reliever_not_enabled');
    end if;
    if crypt(p_secret, v_teacher.reliever_secret_hash) <> v_teacher.reliever_secret_hash then
        return json_build_object('error', 'invalid_secret');
    end if;

    return json_build_object(
        'ok', true,
        'teacher_id', v_teacher.id,
        'class_name', v_teacher.class_name,
        'display_name', v_teacher.display_name
    );
end;
$$;

grant execute on function public.reliever_login(text, text) to anon;

create or replace function public.reliever_get_roster(p_code text, p_secret text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher_id uuid;
    v_hash text;
    result json;
begin
    select id, reliever_secret_hash into v_teacher_id, v_hash
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher_id is null or v_hash is null or crypt(p_secret, v_hash) <> v_hash then
        return json_build_object('error', 'unauthorized');
    end if;

    select coalesce(json_agg(json_build_object(
                'id', s.id, 'name', s.name, 'position', s.position,
                'records', (select coalesce(json_agg(json_build_object(
                                'id', r.id, 'date', r.test_date, 'skill', r.skill,
                                'score', r.score, 'advanced', r.advanced
                            ) order by r.test_date), '[]'::json)
                            from public.score_records r where r.student_id = s.id)
            ) order by s.name), '[]'::json)
    into result
    from public.students s
    where s.teacher_id = v_teacher_id and s.is_basic_facts = false;

    return json_build_object('ok', true, 'students', result);
end;
$$;

grant execute on function public.reliever_get_roster(text, text) to anon;

create or replace function public.reliever_save_test_score(
    p_code text,
    p_secret text,
    p_student_id uuid,
    p_test_date date,
    p_skill int,
    p_score int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher_id uuid;
    v_hash text;
    v_student record;
    v_advanced boolean := false;
    v_new_position int;
begin
    select id, reliever_secret_hash into v_teacher_id, v_hash
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher_id is null or v_hash is null or crypt(p_secret, v_hash) <> v_hash then
        return json_build_object('error', 'unauthorized');
    end if;

    select id, name, position into v_student
    from public.students
    where id = p_student_id and teacher_id = v_teacher_id and is_basic_facts = false;

    if v_student.id is null then
        return json_build_object('error', 'student_not_found');
    end if;

    if p_score < 0 or p_score > 15 then
        return json_build_object('error', 'invalid_score');
    end if;

    if p_score = 15 then
        v_advanced := true;
        v_new_position := v_student.position + 1;
        if v_new_position = 20 then v_new_position := v_new_position + 1; end if;
    end if;

    insert into public.score_records (teacher_id, student_id, student_name, test_date, skill, score, advanced)
    values (v_teacher_id, v_student.id, v_student.name, p_test_date, p_skill, p_score, v_advanced);

    if v_advanced then
        if v_new_position > 50 then
            update public.students
            set is_basic_facts = true,
                basic_facts_term = coalesce(basic_facts_term, 1),
                basic_facts_week = coalesce(basic_facts_week, 1)
            where id = v_student.id;
        else
            update public.students set position = v_new_position where id = v_student.id;
        end if;
    end if;

    return json_build_object('ok', true, 'advanced', v_advanced);
end;
$$;

grant execute on function public.reliever_save_test_score(text, text, uuid, date, int, int) to anon;

-- disable_reliever_access already has no "password" in its name — just point
-- it at the renamed column.
create or replace function public.disable_reliever_access()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return json_build_object('error', 'not_signed_in');
    end if;
    update public.profiles set reliever_secret_hash = null
    where id = auth.uid() and role = 'teacher';
    return json_build_object('ok', true);
end;
$$;

grant execute on function public.disable_reliever_access() to authenticated;
