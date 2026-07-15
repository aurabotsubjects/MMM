-- ═══════════════════════════════════════════════════════
--  MMM Classroom Tools — migration
--  Run this once to let the class-code view page show each
--  student's full score history (needed for the score-history
--  chart students/parents can now see when they click their name).
--  Safe to run again — it just replaces the function.
-- ═══════════════════════════════════════════════════════

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
