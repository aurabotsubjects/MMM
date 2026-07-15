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
    created_at timestamptz not null default now()
);

create table public.students (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references public.profiles(id) on delete cascade,
    name text not null,
    position int not null default 1 check (position between 1 and 50),
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

-- ── Row Level Security ────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.score_records enable row level security;

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
        'students', coalesce(json_agg(t order by t.position, t.name), '[]'::json)
    ) into result
    from (
        select
            s.id,
            s.name,
            s.position,
            (select r.test_date from public.score_records r
                where r.student_id = s.id order by r.test_date desc limit 1) as last_test_date,
            (select r.score from public.score_records r
                where r.student_id = s.id order by r.test_date desc limit 1) as last_score,
            (select count(*) from public.score_records r where r.student_id = s.id) as tests_taken,
            (select round(avg(r.score)::numeric, 1) from public.score_records r where r.student_id = s.id) as avg_score,
            (select coalesce(json_agg(json_build_object(
                        'date', r.test_date, 'skill', r.skill, 'score', r.score, 'advanced', r.advanced
                     ) order by r.test_date), '[]'::json)
                from public.score_records r where r.student_id = s.id) as records
        from public.students s
        where s.teacher_id = v_teacher_id
    ) t;

    return result;
end;
$$;

grant execute on function public.get_class_view(text) to anon, authenticated;

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
