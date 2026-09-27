-- Run after upgrade_roles_investors.sql, upgrade_approval_emails.sql and
-- upgrade_course_journey.sql in the Supabase SQL Editor.
-- Administrators may promote an approved member without re-approving the
-- account. A role change does not enqueue a second membership approval email.

create or replace function public.promote_member_to_teacher(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_membership_status text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user is null or p_user = (select auth.uid()) then
    raise exception 'Select another member to promote';
  end if;

  select p.role, p.membership_status into v_role, v_membership_status
    from public.profiles p where p.id = p_user for update;
  if not found then raise exception 'Member not found'; end if;
  if v_role <> 'member' or v_membership_status <> 'approved' then
    raise exception 'Only an approved member can be promoted to teacher';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null
  ) then raise exception 'The member must verify their email first'; end if;

  update public.profiles
     set role = 'teacher', application_type = 'teacher'
   where id = p_user;

  -- Keep an unsent first-approval email aligned with the new role. A worker
  -- that claimed the old member job may fail its current check; leave one
  -- retry available even if that claim was the eighth attempt.
  update public.approval_email_outbox j
     set application_type = 'teacher',
         attempts = case when j.status = 'processing' then least(j.attempts, 7)
                         else j.attempts end
   where j.user_id = p_user and j.status <> 'sent';

  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'member_promoted_to_teacher', 'profile', p_user);
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    values (p_user, 'membership', 'Teacher access is ready. Complete your teaching profile.', 'teacher', p_user);
end $$;
revoke all on function public.promote_member_to_teacher(uuid) from public, anon, authenticated;
grant execute on function public.promote_member_to_teacher(uuid) to authenticated;

-- For a new member applicant, change the requested role inside the same
-- transaction as the existing approval review. The review function and
-- approval trigger still require verified email and a complete application;
-- they create the usual audit entry, notification and first approval email.
create or replace function public.approve_member_applicant_as_teacher(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_type text; v_status text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user is null or p_user = (select auth.uid()) then
    raise exception 'Select another applicant to approve';
  end if;

  select p.role, p.application_type, p.membership_status into v_role, v_type, v_status
    from public.profiles p where p.id = p_user for update;
  if not found then raise exception 'Applicant not found'; end if;
  if v_role <> 'member' or v_type <> 'member' or v_status not in ('pending', 'rejected') then
    raise exception 'Select a pending or rejected member applicant';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null
  ) then raise exception 'The applicant must verify their email first'; end if;

  update public.profiles set application_type = 'teacher' where id = p_user;
  perform public.review_membership(p_user, 'approved');
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    values (p_user, 'membership', 'Teacher access is ready. Complete your teaching profile.', 'teacher', p_user);
  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'member_application_approved_as_teacher', 'profile', p_user);
end $$;
revoke all on function public.approve_member_applicant_as_teacher(uuid) from public, anon, authenticated;
grant execute on function public.approve_member_applicant_as_teacher(uuid) to authenticated;

-- The teacher completes this form after gaining access. It records practical
-- teaching interests and availability; it is not a credential verification.
create table if not exists public.teacher_profiles (
  teacher_id uuid primary key references public.profiles(id) on delete cascade,
  track text not null check (track in (
    'Controls and Automation', 'Software and Programming',
    'Electronics and Robotics', 'AI & Machine Learning'
  )),
  experience text not null check (char_length(btrim(experience)) between 20 and 2000),
  practical_focus text not null check (char_length(btrim(practical_focus)) between 20 and 2000),
  availability text not null check (char_length(btrim(availability)) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_teacher_profile_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.touch_teacher_profile_updated_at() from public, anon, authenticated;
drop trigger if exists touch_teacher_profile_updated_at on public.teacher_profiles;
create trigger touch_teacher_profile_updated_at before update on public.teacher_profiles
  for each row execute function public.touch_teacher_profile_updated_at();

alter table public.teacher_profiles enable row level security;
revoke all on public.teacher_profiles from public, anon, authenticated;
grant select on public.teacher_profiles to authenticated;
grant insert(teacher_id, track, experience, practical_focus, availability)
  on public.teacher_profiles to authenticated;
grant update(track, experience, practical_focus, availability)
  on public.teacher_profiles to authenticated;

drop policy if exists "Teachers and admins read teaching profiles" on public.teacher_profiles;
create policy "Teachers and admins read teaching profiles"
  on public.teacher_profiles for select to authenticated
  using (public.is_admin() or (public.is_teacher() and teacher_id = (select auth.uid())));

drop policy if exists "Teachers create their teaching profile" on public.teacher_profiles;
create policy "Teachers create their teaching profile"
  on public.teacher_profiles for insert to authenticated
  with check (public.is_teacher() and teacher_id = (select auth.uid()));

drop policy if exists "Teachers edit their teaching profile" on public.teacher_profiles;
create policy "Teachers edit their teaching profile"
  on public.teacher_profiles for update to authenticated
  using (public.is_teacher() and teacher_id = (select auth.uid()))
  with check (public.is_teacher() and teacher_id = (select auth.uid()));
