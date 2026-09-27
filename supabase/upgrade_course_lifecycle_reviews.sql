-- Run after upgrade_course_classroom_access.sql, upgrade_course_planning.sql,
-- upgrade_course_journey.sql and upgrade_founder_teaching_roles.sql.
-- Safe to rerun. New enrollment closes when a course ends; existing learners
-- retain access to submissions, revisions, feedback and course files.

begin;

alter table public.courses add column if not exists status text;
update public.courses set status = 'active' where status is null;
alter table public.courses alter column status set default 'active';
alter table public.courses alter column status set not null;
alter table public.courses drop constraint if exists courses_status_check;
alter table public.courses add constraint courses_status_check
  check (status in ('active','ended','archived'));
revoke update(status), insert(status) on public.courses from public, anon, authenticated;

alter table public.course_submissions
  add column if not exists seen_at timestamptz;
alter table public.course_submissions
  add column if not exists seen_by uuid references public.profiles(id) on delete set null;
-- Previously reviewed attempts were necessarily seen during feedback.
update public.course_submissions
   set seen_at = reviewed_at, seen_by = reviewed_by
 where review_status <> 'submitted' and reviewed_at is not null
   and seen_at is null;
revoke update(seen_at,seen_by) on public.course_submissions
  from public, anon, authenticated;

-- The enrollment SELECT policy joins courses for teacher access. Use a
-- narrowly scoped definer helper here to avoid recursive RLS evaluation.
create or replace function public.has_course_enrollment(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_enrollments e
     where e.course_id = p_course and e.learner_id = (select auth.uid())
  );
$$;
revoke all on function public.has_course_enrollment(uuid)
  from public, anon, authenticated;
grant execute on function public.has_course_enrollment(uuid) to authenticated;

-- Active and ended workshops remain in the club catalog. Archive hides a
-- workshop from everyone except its enrolled learners, assigned teacher and
-- administrators, preserving every private record and uploaded file.
drop policy if exists "Members view courses" on public.courses;
create policy "Members view courses" on public.courses
  for select to authenticated using (
    public.is_approved() and (
      status <> 'archived' or public.is_admin()
      or (public.is_teacher() and instructor_id = (select auth.uid()))
      or public.has_course_enrollment(id)
    )
  );

-- Both browser enrollment and assignment RPCs must fail once a workshop has
-- ended. RLS protects browser INSERTs; the trigger locks the course row to
-- serialize against a simultaneous end/archive/delete by its teacher.
drop policy if exists "Approved learners enroll themselves" on public.course_enrollments;
create policy "Approved learners enroll themselves" on public.course_enrollments
  for insert to authenticated with check (
    public.is_approved() and learner_id = (select auth.uid())
    and status = 'enrolled' and completed_at is null
    and exists (
      select 1 from public.courses c
       where c.id = course_id and c.status = 'active'
    )
  );

create or replace function public.require_active_course_for_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select c.status into v_status from public.courses c
   where c.id = new.course_id for share;
  if v_status is distinct from 'active' then
    raise exception 'This workshop is no longer accepting new students';
  end if;
  return new;
end $$;
revoke all on function public.require_active_course_for_enrollment()
  from public, anon, authenticated;
drop trigger if exists require_active_course_for_enrollment on public.course_enrollments;
create trigger require_active_course_for_enrollment
  before insert on public.course_enrollments for each row
  execute function public.require_active_course_for_enrollment();

-- Preserve the original email lookup, approval checks and assignment notice.
-- Add a status check even though the trigger also protects privileged INSERTs.
create or replace function public.assign_course_learner(
  p_course uuid,
  p_email text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_course public.courses%rowtype;
  v_email text := lower(btrim(p_email));
  v_learner uuid;
  v_enrollment uuid;
begin
  select p.role = 'admin' into v_admin
    from public.profiles p
   where p.id = (select auth.uid())
     and p.membership_status = 'approved'
     and (p.role in ('teacher','admin')
       or (p.role = 'founder' and p.founder_teaching_enabled))
   for share;
  if not found then raise exception 'Teacher or administrator access required'; end if;

  select * into v_course from public.courses where id = p_course for update;
  if not found then raise exception 'Workshop not found'; end if;
  if not v_admin and v_course.instructor_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher can enroll learners';
  end if;
  if v_course.status <> 'active' then
    raise exception 'This workshop is no longer accepting new students';
  end if;
  if v_email is null or char_length(v_email) not between 3 and 320 then
    raise exception 'Enter the learner''s sign-in email';
  end if;

  select p.id into v_learner
    from auth.users u
    join public.profiles p on p.id = u.id
   where lower(u.email) = v_email
     and u.email_confirmed_at is not null
     and p.membership_status = 'approved'
     and p.role in ('member','teacher','founder','admin')
   for share of p;
  if not found then
    raise exception 'No eligible approved club member found for that email';
  end if;

  insert into public.course_enrollments(course_id,learner_id)
    values (p_course,v_learner)
    on conflict (course_id,learner_id) do nothing
    returning id into v_enrollment;
  if v_enrollment is null then
    select id into v_enrollment from public.course_enrollments
     where course_id = p_course and learner_id = v_learner;
    return v_enrollment;
  end if;

  insert into public.audit_events(actor_id,action,target_type,target_id)
    values ((select auth.uid()),'course_learner_assigned','course',p_course);
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values (v_learner,'course','You were enrolled in: ' || v_course.title,'course',p_course);
  return v_enrollment;
end $$;
revoke all on function public.assign_course_learner(uuid,text)
  from public, anon, authenticated;
grant execute on function public.assign_course_learner(uuid,text) to authenticated;

-- End closes new enrollment, but students already enrolled may still hand
-- in work, request help and receive feedback, including revisions.
create or replace function public.end_course(p_course uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin boolean; v_course public.courses%rowtype;
begin
  select p.role = 'admin' into v_admin from public.profiles p
   where p.id = (select auth.uid()) and p.membership_status = 'approved'
     and (p.role in ('teacher','admin')
       or (p.role = 'founder' and p.founder_teaching_enabled))
   for share;
  if not found then raise exception 'Teacher or administrator access required'; end if;

  select * into v_course from public.courses where id = p_course for update;
  if not found then raise exception 'Workshop not found'; end if;
  if not v_admin and v_course.instructor_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher can end this workshop';
  end if;
  if v_course.status = 'ended' then return; end if;
  if v_course.status <> 'active' then
    raise exception 'An archived workshop cannot be ended again';
  end if;

  update public.courses set status = 'ended' where id = p_course;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values ((select auth.uid()),'course_ended','course',p_course);
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    select e.learner_id,'course','Workshop ended: ' || v_course.title,
           'course',p_course
      from public.course_enrollments e
     where e.course_id = p_course and e.learner_id <> (select auth.uid());
end $$;
revoke all on function public.end_course(uuid) from public, anon, authenticated;
grant execute on function public.end_course(uuid) to authenticated;

-- A genuinely unused draft can be deleted; otherwise deletion only archives
-- it. Cascading enrollment/submission/completion FKs must never erase work.
create or replace function public.delete_course(p_course uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_admin boolean; v_course public.courses%rowtype;
begin
  select p.role = 'admin' into v_admin from public.profiles p
   where p.id = (select auth.uid()) and p.membership_status = 'approved'
     and (p.role in ('teacher','admin')
       or (p.role = 'founder' and p.founder_teaching_enabled))
   for share;
  if not found then raise exception 'Teacher or administrator access required'; end if;

  select * into v_course from public.courses where id = p_course for update;
  if not found then raise exception 'Workshop not found'; end if;
  if not v_admin and v_course.instructor_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher can remove this workshop';
  end if;

  if not exists (select 1 from public.course_enrollments where course_id = p_course)
    and not exists (select 1 from public.course_submissions where course_id = p_course)
    and not exists (select 1 from public.course_completions where course_id = p_course)
    and not exists (select 1 from public.learning_materials where course_id = p_course)
    and not exists (
      -- An upload can exist before its submission row is committed. Do not
      -- strand even an unsubmitted file by hard deleting its workshop.
      select 1 from storage.objects o
       where o.bucket_id = 'club-course-evidence'
         and split_part(o.name, '/', 2) = p_course::text
    )
  then
    delete from public.courses where id = p_course;
    insert into public.audit_events(actor_id,action,target_type,target_id)
      values ((select auth.uid()),'course_deleted_unused','course',p_course);
    return 'deleted';
  end if;

  if v_course.status <> 'archived' then
    update public.courses set status = 'archived' where id = p_course;
    insert into public.audit_events(actor_id,action,target_type,target_id)
      values ((select auth.uid()),'course_archived','course',p_course);
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      select e.learner_id,'course','Workshop archived: ' || v_course.title,
             'course',p_course
        from public.course_enrollments e
       where e.course_id = p_course and e.learner_id <> (select auth.uid());
  end if;
  return 'archived';
end $$;
revoke all on function public.delete_course(uuid) from public, anon, authenticated;
grant execute on function public.delete_course(uuid) to authenticated;

-- Seen is separate from reviewed: a teacher can acknowledge the project
-- without accepting it or requesting a revision. Only the current assigned
-- teacher or an administrator may acknowledge, never its author.
create or replace function public.mark_course_submission_seen(p_submission uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_course_id uuid;
  v_instructor uuid;
  v_submission public.course_submissions%rowtype;
begin
  select p.role = 'admin' into v_admin from public.profiles p
   where p.id = (select auth.uid()) and p.membership_status = 'approved'
     and (p.role in ('teacher','admin')
       or (p.role = 'founder' and p.founder_teaching_enabled))
   for share;
  if not found then raise exception 'Teacher or administrator access required'; end if;

  select s.course_id into v_course_id
    from public.course_submissions s where s.id = p_submission;
  if not found then raise exception 'Submission not found'; end if;
  select c.instructor_id into v_instructor from public.courses c
    where c.id = v_course_id for share;
  if not v_admin and v_instructor is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher may mark this submission seen';
  end if;
  select * into v_submission from public.course_submissions
    where id = p_submission for update;
  if v_submission.learner_id = (select auth.uid()) then
    raise exception 'You cannot mark your own work seen';
  end if;
  if not exists (
    select 1 from public.course_enrollments e
     where e.course_id = v_submission.course_id
       and e.learner_id = v_submission.learner_id
  ) then raise exception 'Submission learner is not enrolled'; end if;
  if v_submission.seen_at is not null or v_submission.review_status <> 'submitted'
  then return; end if;

  update public.course_submissions
     set seen_at = now(), seen_by = (select auth.uid())
   where id = p_submission;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values ((select auth.uid()),'course_submission_seen','course_submission',p_submission);
end $$;
revoke all on function public.mark_course_submission_seen(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_course_submission_seen(uuid) to authenticated;

-- Existing review_course_submission() keeps its feedback/completion rules;
-- this trigger makes a successful review implicitly acknowledge the attempt.
create or replace function public.see_reviewed_course_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.review_status = 'submitted'
    and new.review_status in ('accepted','revision_requested')
    and new.seen_at is null then
    new.seen_at := now();
    new.seen_by := (select auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.see_reviewed_course_submission()
  from public, anon, authenticated;
drop trigger if exists see_reviewed_course_submission on public.course_submissions;
create trigger see_reviewed_course_submission
  before update of review_status on public.course_submissions
  for each row execute function public.see_reviewed_course_submission();

commit;
