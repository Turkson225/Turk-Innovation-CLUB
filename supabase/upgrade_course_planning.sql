-- Run after upgrade_course_journey.sql, upgrade_founder_teaching_roles.sql,
-- upgrade_privacy_requests.sql and upgrade_membership_collaboration.sql.
-- A workshop's deadline is informational: learners may still submit work or
-- revisions after it. Existing workshop inserts without a date still work.

begin;

alter table public.courses
  add column if not exists submission_due_at timestamptz;
alter table public.courses
  drop constraint if exists courses_submission_schedule_check;
alter table public.courses
  add constraint courses_submission_schedule_check
    check (starts_at is null or submission_due_at is null
      or submission_due_at > starts_at);

-- The course journey upgrade grants INSERT by column. Let a teacher set an
-- initial deadline without granting direct UPDATE of a published workshop.
grant insert(submission_due_at) on public.courses to authenticated;
revoke update on public.courses from public,anon,authenticated;

-- An administrator may edit any schedule. An approved teacher or teaching
-- founder may edit only their assigned workshop. Lock the actor's profile and
-- then the course so role changes or reassignment cannot race the decision.
create or replace function public.update_course_schedule(
  p_course uuid,
  p_starts_at timestamptz,
  p_due_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_course public.courses%rowtype;
begin
  select p.role = 'admin' into v_admin
    from public.profiles p
   where p.id = (select auth.uid())
     and p.membership_status = 'approved'
     and (p.role in ('teacher','admin')
       or (p.role = 'founder' and p.founder_teaching_enabled))
   for share;
  if not found then raise exception 'Teacher or administrator access required'; end if;

  if p_starts_at is not null and p_due_at is not null
     and p_due_at <= p_starts_at then
    raise exception 'The submission deadline must be after the workshop start';
  end if;
  select * into v_course from public.courses where id = p_course for update;
  if not found then raise exception 'Workshop not found'; end if;
  if not v_admin and v_course.instructor_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher can update this workshop';
  end if;
  if v_course.starts_at is not distinct from p_starts_at
     and v_course.submission_due_at is not distinct from p_due_at then
    return;
  end if;

  update public.courses
     set starts_at = p_starts_at, submission_due_at = p_due_at
   where id = p_course;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values ((select auth.uid()),'course_schedule_updated','course',p_course);
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    select e.learner_id,'course',
           'Workshop schedule updated: ' || v_course.title,'course',p_course
      from public.course_enrollments e
     where e.course_id = p_course and e.status = 'enrolled';
end $$;
revoke all on function public.update_course_schedule(uuid,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.update_course_schedule(uuid,timestamptz,timestamptz)
  to authenticated;

-- Assigned teachers and admins can add an approved club learner by their
-- verified sign-in email. The function reveals no email or profile fields.
-- A repeated request returns the existing enrollment without a duplicate
-- notification; a completed enrollment is not reset.
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
  from public,anon,authenticated;
grant execute on function public.assign_course_learner(uuid,text)
  to authenticated;

-- Removal is limited to an untouched active enrollment. Locking that row
-- serializes with the existing submission trigger, which locks the same row
-- before accepting a learner's work.
create or replace function public.unassign_course_learner(
  p_course uuid,
  p_learner uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_course public.courses%rowtype;
  v_enrollment public.course_enrollments%rowtype;
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
    raise exception 'Only the assigned teacher can remove learners';
  end if;

  select * into v_enrollment from public.course_enrollments
   where course_id = p_course and learner_id = p_learner for update;
  if not found then return; end if;
  if v_enrollment.status <> 'enrolled'
     or exists (select 1 from public.course_submissions
                 where course_id = p_course and learner_id = p_learner)
     or exists (select 1 from public.course_completions
                 where course_id = p_course and learner_id = p_learner) then
    raise exception 'A learner with submitted or completed work cannot be removed';
  end if;

  delete from public.course_enrollments where id = v_enrollment.id;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values ((select auth.uid()),'course_learner_unassigned','course',p_course);
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values (p_learner,'course','You were removed from: ' || v_course.title,'course',p_course);
end $$;
revoke all on function public.unassign_course_learner(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.unassign_course_learner(uuid,uuid)
  to authenticated;

-- Profile privacy still hides the rest of a private learner's directory
-- record. Teachers see only names of learners in their own workshops;
-- administrators see all rosters. Neither receives email or profile details.
create or replace function public.teacher_course_roster()
returns table(course_id uuid, learner_id uuid, full_name text, status text)
language sql stable security definer set search_path = '' as $$
  select e.course_id,e.learner_id,p.full_name,e.status
    from public.course_enrollments e
    join public.courses c on c.id = e.course_id
    join public.profiles p on p.id = e.learner_id
   where public.is_admin()
      or (public.is_teacher() and c.instructor_id = (select auth.uid()));
$$;
revoke all on function public.teacher_course_roster()
  from public,anon,authenticated;
grant execute on function public.teacher_course_roster() to authenticated;

-- A learner's own enrollment appears in the assigned instructor's inbox.
-- Teacher/admin assignments are handled by the RPC above, so they do not
-- create a redundant notification for the actor.
create or replace function public.notify_course_self_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_instructor uuid;
  v_title text;
begin
  if new.learner_id is distinct from (select auth.uid()) then return new; end if;
  select c.instructor_id,c.title into v_instructor,v_title
    from public.courses c where c.id = new.course_id;
  if v_instructor is not null and v_instructor <> new.learner_id then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values (v_instructor,'course',
        'New learner enrolled in: ' || v_title,'teacher',new.course_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_course_self_enrollment()
  from public,anon,authenticated;
drop trigger if exists notify_course_self_enrollment on public.course_enrollments;
create trigger notify_course_self_enrollment
  after insert on public.course_enrollments
  for each row execute function public.notify_course_self_enrollment();

commit;
