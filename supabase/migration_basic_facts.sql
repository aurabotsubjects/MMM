-- ═══════════════════════════════════════════════════════
--  MMM Classroom Tools — migration
--  Adds "Basic Facts" as the tier students move into after
--  finishing all 50 MMM skills: a 5-minute, 100-question
--  timed test students can take themselves on the class-code
--  page, with full history/graphs for both students and the
--  teacher, and a printable worksheet per term/week.
--  Safe to run again.
-- ═══════════════════════════════════════════════════════

-- 1. Flag students as Basic Facts, and track which term/week they're
--    currently assigned to test on.
alter table public.students
    add column if not exists is_basic_facts boolean not null default false;

alter table public.students
    add column if not exists basic_facts_term int;

alter table public.students
    add column if not exists basic_facts_week int;

-- 2. Every test attempt a student makes.
create table if not exists public.basic_facts_attempts (
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

create index if not exists basic_facts_attempts_teacher_idx on public.basic_facts_attempts(teacher_id);
create index if not exists basic_facts_attempts_student_idx on public.basic_facts_attempts(student_id);

alter table public.basic_facts_attempts enable row level security;

drop policy if exists "teacher manages own basic facts attempts" on public.basic_facts_attempts;
create policy "teacher manages own basic facts attempts" on public.basic_facts_attempts
    for all using (teacher_id = auth.uid())
    with check (teacher_id = auth.uid());

-- 3. Let a student on the class-code page submit their own attempt,
--    without any login, but only for a student that's really in that
--    class and really marked as Basic Facts — this function resolves
--    the teacher/ownership server-side so a client can't fake an
--    attempt against another class's data.
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

-- 4. Extend the public class-view function so the class-code page can
--    show Basic Facts students, their assigned term/week, and their
--    attempt history for charting.
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
