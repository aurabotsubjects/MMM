-- ═══════════════════════════════════════════════════════
--  MMM Classroom Tools — migration
--  Adds "reliever" (substitute teacher) access. A teacher sets
--  a reliever password; the reliever then signs in on the same
--  teacher login page using the CLASS CODE as their username and
--  that password. No separate Supabase Auth account is created —
--  everything is verified through these functions, re-checking the
--  password on every call (since there's no real login session).
--  Safe to run again.
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

alter table public.profiles
    add column if not exists reliever_password_hash text;

-- Teacher sets/changes their own reliever password (must be signed in).
create or replace function public.set_reliever_password(p_new_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return json_build_object('error', 'not_signed_in');
    end if;
    if p_new_password is null or length(p_new_password) < 4 then
        return json_build_object('error', 'password_too_short');
    end if;

    update public.profiles
    set reliever_password_hash = crypt(p_new_password, gen_salt('bf'))
    where id = auth.uid() and role = 'teacher';

    return json_build_object('ok', true);
end;
$$;

grant execute on function public.set_reliever_password(text) to authenticated;

-- Teacher turns reliever access off entirely.
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
    update public.profiles set reliever_password_hash = null
    where id = auth.uid() and role = 'teacher';
    return json_build_object('ok', true);
end;
$$;

grant execute on function public.disable_reliever_access() to authenticated;

-- Reliever "login" — just verifies the class code + password combination.
create or replace function public.reliever_login(p_code text, p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher record;
begin
    select id, class_name, display_name, reliever_password_hash into v_teacher
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher.id is null then
        return json_build_object('error', 'not_found');
    end if;
    if v_teacher.reliever_password_hash is null then
        return json_build_object('error', 'reliever_not_enabled');
    end if;
    if crypt(p_password, v_teacher.reliever_password_hash) <> v_teacher.reliever_password_hash then
        return json_build_object('error', 'invalid_password');
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

-- Reliever fetches the MMM (non-Basic-Facts) roster + score history, so the
-- Test Scores tab can render exactly like it does for the real teacher.
create or replace function public.reliever_get_roster(p_code text, p_password text)
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
    select id, reliever_password_hash into v_teacher_id, v_hash
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher_id is null or v_hash is null or crypt(p_password, v_hash) <> v_hash then
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

-- Reliever saves one test score — inserts the record and, on a 15/15,
-- advances the student a skill (promoting to Basic Facts past skill 50),
-- exactly like the teacher's own score-entry flow.
create or replace function public.reliever_save_test_score(
    p_code text,
    p_password text,
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
    select id, reliever_password_hash into v_teacher_id, v_hash
    from public.profiles
    where upper(class_code) = upper(p_code) and role = 'teacher' and status = 'approved';

    if v_teacher_id is null or v_hash is null or crypt(p_password, v_hash) <> v_hash then
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
