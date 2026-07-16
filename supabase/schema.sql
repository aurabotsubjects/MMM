-- ═══════════════════════════════════════════════════════
--  MMM Classroom Tools — Supabase schema
--  Run this once in Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Tables ────────────────────────────────────────────────

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    role text not null check (role in ('admin','teacher')),
    status text not null default 'pending' check (status in ('pending','approved','rejected')),
    display_name text not null default '',
    class_name text not null default '',
    class_code text unique,
    reliever_password_hash text,
    created_at timestamptz not null default now()
);

create table public.students (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references public.profiles(id) on delete cascade,
    name text not null,
    position int not null default 1 check (position between 1 and 50),
    is_basic_facts boolean not null default false,
    basic_facts_term int,
    basic_facts_week int,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.score_records (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references public.profiles(id) on delete cascade,
    student_id uuid references public.students(id) on delete set null,
    student_name text not null,
    test_date date not null,
    skill int not null,
    score int not null check (score between 0 and 15),
    advanced boolean not null default false,
    created_at timestamptz not null default now()
);

create index students_teacher_idx on public.students(teacher_id);
create index score_records_teacher_idx on public.score_records(teacher_id);
create index score_records_student_idx on public.score_records(student_id);

create table public.basic_facts_attempts (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references public.profiles(id) on delete cascade,
    student_id uuid references public.students(id) on delete set null,
    student_name text not null,
    term int not null,
    week int not null,
    correct int not null check (correct between 0 and 100),
    attempted int not null check (attempted between 0 and 100),
    time_seconds int not null check (time_seconds between 0 and 300),
    timed_out boolean not null default false,
    attempted_at timestamptz not null default now()
);

create index basic_facts_attempts_teacher_idx on public.basic_facts_attempts(teacher_id);
create index basic_facts_attempts_student_idx on public.basic_facts_attempts(student_id);

-- ── Row Level Security ────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.score_records enable row level security;
alter table public.basic_facts_attempts enable row level security;

-- Helper: is the current user an admin? (security definer avoids RLS recursion)
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

-- profiles: a teacher can read/update their own row; admin can read/update/delete all.
create policy "read own profile" on public.profiles
    for select using (auth.uid() = id or public.is_admin());

-- A signed-up user may create exactly one profile row for themselves, and only
-- ever as a *pending teacher* — they can never insert themselves as approved
-- or as an admin. (The one admin account is created directly via SQL — see
-- the bottom of this file.)
create policy "self signup as pending teacher" on public.profiles
    for insert with check (
        auth.uid() = id and role = 'teacher' and status = 'pending'
    );

create policy "teacher updates own profile" on public.profiles
    for update using (auth.uid() = id)
    with check (auth.uid() = id);

create policy "admin manages all profiles" on public.profiles
    for update using (public.is_admin())
    with check (public.is_admin());

create policy "admin deletes profiles" on public.profiles
    for delete using (public.is_admin());

-- Defense in depth: even though the update policies above allow a teacher to
-- update their own row (e.g. to regenerate their class code), block them from
-- ever changing their own role or approval status — only an admin can do that.
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

create trigger protect_profile_fields_trigger
    before update on public.profiles
    for each row execute function public.protect_profile_fields();

-- students: teachers manage only their own students.
create policy "teacher manages own students" on public.students
    for all using (teacher_id = auth.uid())
    with check (teacher_id = auth.uid());

-- score_records: teachers manage only their own records.
create policy "teacher manages own scores" on public.score_records
    for all using (teacher_id = auth.uid())
    with check (teacher_id = auth.uid());

-- basic_facts_attempts: teachers manage only their own records.
create policy "teacher manages own basic facts attempts" on public.basic_facts_attempts
    for all using (teacher_id = auth.uid())
    with check (teacher_id = auth.uid());

-- ── Public class-code lookup (read-only, no login required) ──
-- Runs as SECURITY DEFINER so it can bypass RLS, but it only ever
-- returns data for the single teacher whose class_code matches —
-- it never exposes the raw tables to anonymous users.
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
        'students', coalesce(json_agg(t order by t.is_basic_facts, t.position, t.name), '[]'::json)
    ) into result
    from (
        select
            s.id,
            s.name,
            s.position,
            s.is_basic_facts,
            s.basic_facts_term,
            s.basic_facts_week,
            (select r.test_date from public.score_records r
                where r.student_id = s.id order by r.test_date desc limit 1) as last_test_date,
            (select r.score from public.score_records r
                where r.student_id = s.id order by r.test_date desc limit 1) as last_score,
            (select count(*) from public.score_records r where r.student_id = s.id) as tests_taken,
            (select round(avg(r.score)::numeric, 1) from public.score_records r where r.student_id = s.id) as avg_score,
            (select coalesce(json_agg(json_build_object(
                        'date', r.test_date, 'skill', r.skill, 'score', r.score, 'advanced', r.advanced
                     ) order by r.test_date), '[]'::json)
                from public.score_records r where r.student_id = s.id) as records,
            (select coalesce(json_agg(json_build_object(
                        'term', a.term, 'week', a.week, 'correct', a.correct, 'attempted', a.attempted,
                        'time_seconds', a.time_seconds, 'timed_out', a.timed_out, 'attempted_at', a.attempted_at
                     ) order by a.attempted_at), '[]'::json)
                from public.basic_facts_attempts a where a.student_id = s.id) as basic_facts_attempts
        from public.students s
        where s.teacher_id = v_teacher_id
    ) t;

    return result;
end;
$$;

grant execute on function public.get_class_view(text) to anon, authenticated;

-- Lets a student on the class-code page submit their own Basic Facts
-- attempt without logging in — resolves teacher/ownership server-side
-- so a client can never fake an attempt for another class's student.
create or replace function public.submit_basic_facts_attempt(
    p_code text,
    p_student_id uuid,
    p_term int,
    p_week int,
    p_correct int,
    p_attempted int,
    p_time_seconds int,
    p_timed_out boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher_id uuid;
    v_student_name text;
begin
    select p.id into v_teacher_id
    from public.profiles p
    where upper(p.class_code) = upper(p_code) and p.role = 'teacher' and p.status = 'approved';

    if v_teacher_id is null then
        return json_build_object('error', 'not_found');
    end if;

    select name into v_student_name
    from public.students
    where id = p_student_id and teacher_id = v_teacher_id and is_basic_facts = true;

    if v_student_name is null then
        return json_build_object('error', 'student_not_found');
    end if;

    if p_correct < 0 or p_correct > 100 or p_attempted < 0 or p_attempted > 100
       or p_time_seconds < 0 or p_time_seconds > 300 then
        return json_build_object('error', 'invalid_values');
    end if;

    insert into public.basic_facts_attempts
        (teacher_id, student_id, student_name, term, week, correct, attempted, time_seconds, timed_out)
    values
        (v_teacher_id, p_student_id, v_student_name, p_term, p_week, p_correct, p_attempted, p_time_seconds, p_timed_out);

    return json_build_object('ok', true);
end;
$$;

grant execute on function public.submit_basic_facts_attempt(text, uuid, int, int, int, int, int, boolean) to anon, authenticated;

-- ── Reliever (substitute teacher) access ──────────────────
-- A teacher sets a reliever password; the reliever then signs in on the
-- same teacher login page using the CLASS CODE as their username and that
-- password. No separate Supabase Auth account is created — everything is
-- verified through these functions, re-checking the password every call.

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

-- ═══════════════════════════════════════════════════════
--  One-time setup: create your single admin account
--  1. In Supabase → Authentication → Users, click "Add user"
--     and create the admin's email + password (toggle "Auto
--     Confirm User" on).
--  2. Copy the new user's UUID, then run (replacing values):
--
--     insert into public.profiles (id, email, role, status, display_name)
--     values ('PASTE-USER-UUID-HERE', 'admin@example.com', 'admin', 'approved', 'Admin');
--
--  Teachers create their own accounts by using the "Request an
--  account" link on the sign-in page — you just need to approve
--  each request once from the Admin Panel (admin.html).
--
--  IMPORTANT: for a teacher's signup to finish in one step (rather
--  than requiring an email confirmation click first), go to
--  Authentication → Providers → Email in Supabase and turn OFF
--  "Confirm email". If you'd rather keep email confirmation on,
--  that's fine too — the teacher will just need to click the
--  confirmation link in their inbox, then sign up again to finish
--  creating their profile.
-- ═══════════════════════════════════════════════════════
