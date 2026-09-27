-- Run after upgrade_teacher_promotions.sql, upgrade_course_journey.sql and
-- upgrade_approval_emails.sql. An approved founder has teaching access by
-- default; administrators may pause it without removing founder leadership.
-- Public founder cards are independent records, not linked to user profiles.

alter table public.profiles
  add column if not exists founder_teaching_enabled boolean not null default true;
-- All founders in the existing directory can teach on installation. A founder
-- whose teaching access is later paused keeps that explicit choice on reruns.
revoke update(founder_teaching_enabled) on public.profiles from anon, authenticated;

create or replace function public.reset_founder_teaching_on_role_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.role is distinct from new.role then
    -- An accepted invitation or approved founder application starts with
    -- teaching access, even after an older member/teacher role had disabled it.
    new.founder_teaching_enabled := (new.role = 'founder');
  end if;
  return new;
end $$;
revoke all on function public.reset_founder_teaching_on_role_change()
  from public, anon, authenticated;
drop trigger if exists reset_founder_teaching_on_role_change on public.profiles;
create trigger reset_founder_teaching_on_role_change
  before update of role on public.profiles for each row
  execute function public.reset_founder_teaching_on_role_change();

-- All existing teaching policies (course publishing, private submissions,
-- workshop review, learning uploads and teaching profile) call this helper.
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.membership_status = 'approved'
       and (p.role in ('teacher', 'admin')
         or (p.role = 'founder' and p.founder_teaching_enabled))
  );
$$;
revoke all on function public.is_teacher() from public, anon, authenticated;
grant execute on function public.is_teacher() to authenticated;

-- Keep workshops assigned to someone who can teach. Because workshops have
-- no archive/enrollment cutoff, even an empty workshop can receive learners.
-- Reassign all of the founder's workshops before ending teaching access.
create or replace function public.set_founder_teaching(p_user uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_enabled boolean;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user is null or p_enabled is null or p_user = (select auth.uid()) then
    raise exception 'Select another founder and a teaching decision';
  end if;
  select p.founder_teaching_enabled into v_enabled
    from public.profiles p where p.id = p_user
      and p.role = 'founder' and p.membership_status = 'approved' for update;
  if not found then raise exception 'Select an approved founder'; end if;
  if v_enabled = p_enabled then return; end if;
  if not p_enabled and exists (
    select 1 from public.courses c where c.instructor_id = p_user
  ) then
    raise exception 'Reassign this founder''s workshops before removing teaching access';
  end if;
  update public.profiles set founder_teaching_enabled = p_enabled where id = p_user;
  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()),
      case when p_enabled then 'founder_teaching_enabled' else 'founder_teaching_disabled' end,
      'profile', p_user);
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    values (p_user, 'membership',
      case when p_enabled then 'Teaching access is ready. Complete your teaching profile.'
        else 'Teaching access has been paused by an administrator.' end,
      case when p_enabled then 'teacher' else 'application' end, p_user);
end $$;
revoke all on function public.set_founder_teaching(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_founder_teaching(uuid, boolean) to authenticated;

-- Change leadership role while retaining either a normal membership or a
-- teacher role. The latter preserves access to the teaching profile and
-- assigned workshop submissions. The public founder card is separate.
create or replace function public.remove_founder_role(p_user uuid, p_next_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user is null or p_user = (select auth.uid()) then
    raise exception 'Select another founder';
  end if;
  if p_next_role is null or p_next_role not in ('member', 'teacher') then
    raise exception 'Choose member or teacher as the next role';
  end if;
  perform 1 from public.profiles p where p.id = p_user and p.role = 'founder' for update;
  if not found then raise exception 'Founder account not found'; end if;
  if p_next_role = 'member' and exists (
    select 1 from public.courses c where c.instructor_id = p_user
  ) then
    raise exception 'Reassign this founder''s workshops before removing teaching access';
  end if;

  -- Also update the application type: reviewing a suspended member later
  -- must not restore founder access from their original founder application.
  update public.profiles
     set role = p_next_role, application_type = p_next_role,
         founder_teaching_enabled = false
   where id = p_user;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is not null then
    -- A pending invitation must not let the same account immediately undo
    -- the administrator's decision. Existing accepted invitations stay put.
    update public.founder_invites set accepted_at = now()
      where email = v_email and accepted_at is null;
  end if;

  -- If the original first-approval message is still queued, its role label
  -- should match the account; a claimed worker can retry the updated job.
  update public.approval_email_outbox j
     set application_type = p_next_role,
         attempts = case when j.status = 'processing' then least(j.attempts, 7)
                         else j.attempts end
   where j.user_id = p_user and j.status <> 'sent';
  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'founder_role_removed_to_' || p_next_role, 'profile', p_user);
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    values (p_user, 'membership',
      case when p_next_role = 'teacher'
        then 'Your founder role has changed to teacher. Teaching access remains available.'
        else 'Your founder role has changed to member. Teaching access has ended.' end,
      case when p_next_role = 'teacher' then 'teacher' else 'application' end, p_user);
end $$;
revoke all on function public.remove_founder_role(uuid, text)
  from public, anon, authenticated;
grant execute on function public.remove_founder_role(uuid, text) to authenticated;

-- A teacher may join founder leadership without losing the teaching studio,
-- teaching profile, learning materials or workshop assignments.
create or replace function public.assign_teacher_as_founder(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user is null or p_user = (select auth.uid()) then
    raise exception 'Select another teacher to assign as founder';
  end if;
  perform 1 from public.profiles p where p.id = p_user
    and p.role = 'teacher' and p.membership_status = 'approved' for update;
  if not found then raise exception 'Select an approved teacher'; end if;
  select lower(u.email) into v_email from auth.users u
    where u.id = p_user and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'The teacher must verify their email first'; end if;

  update public.profiles
     set role = 'founder', application_type = 'founder',
         founder_teaching_enabled = true
   where id = p_user;
  -- Prevent a previously outstanding invitation being accepted later as a
  -- second, confusing route to founder access.
  update public.founder_invites set accepted_at = now()
    where email = v_email and accepted_at is null;
  update public.approval_email_outbox j
     set application_type = 'founder',
         attempts = case when j.status = 'processing' then least(j.attempts, 7)
                         else j.attempts end
   where j.user_id = p_user and j.status <> 'sent';
  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'teacher_promoted_to_founder', 'profile', p_user);
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    values (p_user, 'membership',
      'Founder access is ready. Your teaching studio remains available.',
      'founder', p_user);
end $$;
revoke all on function public.assign_teacher_as_founder(uuid)
  from public, anon, authenticated;
grant execute on function public.assign_teacher_as_founder(uuid) to authenticated;

-- Admins can assign teaching-enabled founders to older or transferred
-- workshops. Lock the teacher profile so a concurrent teaching revocation
-- cannot race with the assignment.
create or replace function public.assign_course_instructor(p_course uuid, p_teacher uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  perform 1 from public.profiles p where p.id = p_teacher
    and p.membership_status = 'approved'
    and (p.role in ('teacher', 'admin')
      or (p.role = 'founder' and p.founder_teaching_enabled)) for share;
  if not found then raise exception 'Select an approved teacher or teaching founder'; end if;
  update public.courses set instructor_id = p_teacher where id = p_course;
  if not found then raise exception 'Workshop not found'; end if;
end $$;
revoke all on function public.assign_course_instructor(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assign_course_instructor(uuid, uuid) to authenticated;

-- RLS alone can evaluate a course INSERT against an earlier snapshot of the
-- instructor's role. Hold a row lock on the assigned teacher until the course
-- INSERT commits, so an administrator cannot remove teaching rights between
-- authorization and the new workshop becoming visible.
create or replace function public.validate_course_instructor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The instructor FK uses ON DELETE SET NULL during account removal. Allow
  -- that cleanup on UPDATE; new workshops still require an eligible teacher.
  if tg_op = 'UPDATE' and new.instructor_id is null then return new; end if;
  perform 1 from public.profiles p where p.id = new.instructor_id
    and p.membership_status = 'approved'
    and (p.role in ('teacher', 'admin')
      or (p.role = 'founder' and p.founder_teaching_enabled)) for share;
  if not found then
    raise exception 'The workshop instructor must be an approved teacher or teaching founder';
  end if;
  return new;
end $$;
revoke all on function public.validate_course_instructor()
  from public, anon, authenticated;
drop trigger if exists validate_course_instructor_insert on public.courses;
create trigger validate_course_instructor_insert
  before insert on public.courses for each row
  execute function public.validate_course_instructor();
drop trigger if exists validate_course_instructor_update on public.courses;
create trigger validate_course_instructor_update
  before update of instructor_id on public.courses for each row
  execute function public.validate_course_instructor();

-- Public founder cards have no profile FK. Removing an account's founder
-- access does not identify which public card to delete, so expose a separate
-- administrator-only delete operation on those cards.
grant delete on public.founders to authenticated;
drop policy if exists "Admins remove public founder cards" on public.founders;
create policy "Admins remove public founder cards"
  on public.founders for delete to authenticated using (public.is_admin());

create or replace function public.audit_founder_card_removal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'founder_card_removed', 'founder_card', old.id);
  return old;
end $$;
revoke all on function public.audit_founder_card_removal()
  from public, anon, authenticated;
drop trigger if exists audit_founder_card_removal on public.founders;
create trigger audit_founder_card_removal
  after delete on public.founders for each row
  execute function public.audit_founder_card_removal();
