-- SPACE: course choices, teaching assignments, classwork and account roles.
-- Run AFTER upgrade_course_lifecycle_reviews.sql, upgrade_private_applications.sql,
-- upgrade_teacher_promotions.sql and upgrade_founder_teaching_roles.sql.
-- Transactional and safe to rerun. No existing learning records are deleted.
begin;

do $$ begin
  if to_regclass('public.course_enrollments') is null
     or to_regclass('public.teacher_profiles') is null
     or to_regclass('public.application_answers') is null
     or to_regclass('public.approval_email_outbox') is null
     or not exists(select 1 from information_schema.columns
       where table_schema='public' and table_name='courses' and column_name='status') then
    raise exception 'Run the course lifecycle, private applications and teacher promotions migrations first';
  end if;
end $$;

create or replace function public.valid_learning_tracks(p_tracks text[])
returns boolean language sql immutable set search_path='' as $$
  select p_tracks is not null and cardinality(p_tracks) between 1 and 4
    and array_position(p_tracks,null) is null
    and p_tracks <@ array['Controls and Automation','Software and Programming',
      'Electronics and Robotics','AI & Machine Learning']::text[]
    and cardinality(p_tracks)=(select count(distinct x) from unnest(p_tracks) x);
$$;
revoke all on function public.valid_learning_tracks(text[]) from public,anon,authenticated;
grant execute on function public.valid_learning_tracks(text[]) to authenticated;

create or replace function public.learning_track_name(p_category text)
returns text language sql immutable set search_path='' as $$
  select case p_category when 'Automation' then 'Controls and Automation'
    when 'Electronics' then 'Electronics and Robotics'
    when 'Embedded systems' then 'Electronics and Robotics'
    when 'Robotics' then 'Electronics and Robotics'
    when 'CAD' then 'Software and Programming'
    when 'Software' then 'Software and Programming' else p_category end;
$$;
revoke all on function public.learning_track_name(text) from public,anon,authenticated;
grant execute on function public.learning_track_name(text) to authenticated;

create table if not exists public.member_learning_paths (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tracks text[] not null check(public.valid_learning_tracks(tracks)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.teaching_track_assignments (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  track text not null check(track in ('Controls and Automation','Software and Programming',
    'Electronics and Robotics','AI & Machine Learning')),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(teacher_id,track)
);
alter table public.member_learning_paths enable row level security;
alter table public.teaching_track_assignments enable row level security;
revoke all on public.member_learning_paths,public.teaching_track_assignments from public,anon,authenticated;
grant select on public.member_learning_paths,public.teaching_track_assignments to authenticated;
drop policy if exists "Own learning choices or admin" on public.member_learning_paths;
create policy "Own learning choices or admin" on public.member_learning_paths
  for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
drop policy if exists "Own teaching courses or admin" on public.teaching_track_assignments;
create policy "Own teaching courses or admin" on public.teaching_track_assignments
  for select to authenticated using(public.is_admin() or teacher_id=(select auth.uid()));

-- Preserve existing teaching responsibilities, including older category names.
insert into public.teaching_track_assignments(teacher_id,track)
select distinct c.instructor_id,case c.category
  when 'Automation' then 'Controls and Automation'
  when 'Electronics' then 'Electronics and Robotics'
  when 'Embedded systems' then 'Electronics and Robotics'
  when 'Robotics' then 'Electronics and Robotics'
  when 'CAD' then 'Software and Programming'
  when 'Software' then 'Software and Programming' else c.category end
from public.courses c join public.profiles p on p.id=c.instructor_id
where p.membership_status='approved' and (p.role in ('teacher','admin')
  or p.role='founder' and p.founder_teaching_enabled)
  and c.category in ('Controls and Automation','Software and Programming','Electronics and Robotics',
    'AI & Machine Learning','Automation','Electronics','Embedded systems','Robotics','CAD','Software')
on conflict do nothing;

create or replace function public.teaches_learning_track(p_track text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or (public.is_teacher() and exists(
    select 1 from public.teaching_track_assignments t
    where t.teacher_id=(select auth.uid()) and t.track=p_track));
$$;
revoke all on function public.teaches_learning_track(text) from public,anon,authenticated;
grant execute on function public.teaches_learning_track(text) to authenticated;

-- Lock the account and course rows before enrolling; the existing enrollment
-- validation trigger still applies. Changes of choices never erase history.
create or replace function public.sync_learning_path_enrollments(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_tracks text[]; v_course uuid;
begin
  perform 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=p_user and p.membership_status='approved'
     and p.role in ('member','teacher','founder','admin') and u.email_confirmed_at is not null
   for share of p;
  if not found then return; end if;
  select tracks into v_tracks from public.member_learning_paths where user_id=p_user;
  if v_tracks is null then return; end if;
  for v_course in select id from public.courses
    where status='active' and public.learning_track_name(category)=any(v_tracks) order by id for share
  loop
    insert into public.course_enrollments(course_id,learner_id) values(v_course,p_user)
      on conflict(course_id,learner_id) do nothing;
  end loop;
end $$;
revoke all on function public.sync_learning_path_enrollments(uuid) from public,anon,authenticated;

create or replace function public.set_my_learning_tracks(p_tracks text[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_tracks text[];
begin
  if not public.valid_learning_tracks(p_tracks) then raise exception 'Select one or more of the four courses'; end if;
  perform 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=v_user and p.membership_status in ('pending','rejected','approved')
      and p.role<>'investor' and u.email_confirmed_at is not null for update of p;
  if not found then raise exception 'Verified club account required'; end if;
  select array_agg(x order by x) into v_tracks from unnest(p_tracks) x;
  insert into public.member_learning_paths(user_id,tracks) values(v_user,v_tracks)
    on conflict(user_id) do update set tracks=excluded.tracks,updated_at=now();
  perform public.sync_learning_path_enrollments(v_user);
end $$;
revoke all on function public.set_my_learning_tracks(text[]) from public,anon,authenticated;
grant execute on function public.set_my_learning_tracks(text[]) to authenticated;

create or replace function public.sync_learning_after_approval()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.membership_status='approved' and
    (old.membership_status is distinct from new.membership_status or old.role is distinct from new.role) then
    perform public.sync_learning_path_enrollments(new.id);
  end if;
  return new;
end $$;
revoke all on function public.sync_learning_after_approval() from public,anon,authenticated;
drop trigger if exists sync_learning_after_approval on public.profiles;
create trigger sync_learning_after_approval after update of membership_status,role on public.profiles
  for each row execute function public.sync_learning_after_approval();

create or replace function public.enroll_learning_path_in_new_class()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='active' then
    with enrolled as (insert into public.course_enrollments(course_id,learner_id)
      select new.id,l.user_id from public.member_learning_paths l
      join public.profiles p on p.id=l.user_id join auth.users u on u.id=p.id
      where public.learning_track_name(new.category)=any(l.tracks) and p.membership_status='approved'
        and p.role in ('member','teacher','founder','admin') and u.email_confirmed_at is not null
      on conflict(course_id,learner_id) do nothing returning learner_id)
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      select learner_id,'course','New class added: '||new.title,'course',new.id from enrolled;
  end if;
  return new;
end $$;
revoke all on function public.enroll_learning_path_in_new_class() from public,anon,authenticated;
drop trigger if exists enroll_learning_path_in_new_class on public.courses;
create trigger enroll_learning_path_in_new_class after insert on public.courses
  for each row execute function public.enroll_learning_path_in_new_class();

create or replace function public.learning_track_roster()
returns table(learner_id uuid,full_name text,track text)
language sql stable security definer set search_path='' as $$
  select p.id,p.full_name,t.track from public.member_learning_paths l
  join public.profiles p on p.id=l.user_id cross join lateral unnest(l.tracks) t(track)
  where p.membership_status='approved' and p.role in ('member','teacher','founder','admin')
    and public.teaches_learning_track(t.track);
$$;
revoke all on function public.learning_track_roster() from public,anon,authenticated;
grant execute on function public.learning_track_roster() to authenticated;

-- The profile form states teaching interests; only admin assignments grant a course.
create or replace function public.validate_course_instructor()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.instructor_id is null then return new; end if;
  perform 1 from public.profiles p where p.id=new.instructor_id and p.membership_status='approved'
    and (p.role in ('teacher','admin') or p.role='founder' and p.founder_teaching_enabled)
    and (p.role='admin' or exists(select 1 from public.teaching_track_assignments t
      where t.teacher_id=p.id and t.track=public.learning_track_name(new.category))) for share;
  if not found then raise exception 'Assign this teacher to the course before publishing or transferring a class'; end if;
  return new;
end $$;
revoke all on function public.validate_course_instructor() from public,anon,authenticated;
drop trigger if exists validate_course_instructor_update on public.courses;
create trigger validate_course_instructor_update before update of instructor_id,category on public.courses
  for each row execute function public.validate_course_instructor();

create or replace function public.assign_account_role(p_user uuid,p_role text,p_tracks text[] default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare v_old text; v_email text; v_type text; v_teaching boolean;
begin
  perform 1 from public.profiles where id=(select auth.uid()) and role='admin'
    and membership_status='approved' for share;
  if not found then raise exception 'Administrator access required'; end if;
  if p_user is null or p_user=(select auth.uid()) then raise exception 'Select another approved account'; end if;
  if p_role is null or p_role not in ('member','teacher','founder','investor','admin') then raise exception 'Choose a valid role'; end if;
  if p_tracks is null or (cardinality(p_tracks)>0 and not public.valid_learning_tracks(p_tracks)) then raise exception 'Choose valid teaching courses'; end if;
  if p_role='teacher' and cardinality(p_tracks)=0 then raise exception 'Assign at least one teaching course'; end if;
  if p_role not in ('teacher','founder') and cardinality(p_tracks)>0 then raise exception 'Teaching courses apply to teachers or teaching founders'; end if;
  select p.role,lower(u.email) into v_old,v_email from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user and p.membership_status='approved' and u.email_confirmed_at is not null for update of p;
  if not found then raise exception 'Select an approved, email-verified account'; end if;
  v_teaching:=p_role='admin' or (p_role in ('teacher','founder') and cardinality(p_tracks)>0);
  if exists(select 1 from public.courses c where c.instructor_id=p_user
    and (not v_teaching or p_role<>'admin' and not public.learning_track_name(c.category)=any(p_tracks))) then
    raise exception 'Reassign this account''s classes before removing its teaching courses or access';
  end if;
  v_type:=case when p_role='admin' then 'member' else p_role end;
  update public.profiles set role=p_role,application_type=v_type where id=p_user;
  update public.profiles set founder_teaching_enabled=(p_role='founder' and v_teaching) where id=p_user;
  delete from public.teaching_track_assignments where teacher_id=p_user;
  insert into public.teaching_track_assignments(teacher_id,track,assigned_by)
    select p_user,x,(select auth.uid()) from unnest(p_tracks) x;
  update public.founder_invites set accepted_at=now() where email=v_email and accepted_at is null;
  update public.approval_email_outbox set application_type=v_type,
    attempts=case when status='processing' then least(attempts,7) else attempts end
    where user_id=p_user and status<>'sent';
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'account_role_'||v_old||'_to_'||p_role,'profile',p_user);
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values(p_user,'membership','Your account role is now '||p_role||'. Open Home to see your dashboard.','application',p_user);
end $$;
revoke all on function public.assign_account_role(uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.assign_account_role(uuid,text,text[]) to authenticated;

create table if not exists public.classroom_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  title text not null check(char_length(btrim(title)) between 3 and 160),
  kind text not null check(kind in ('assignment','practical','project')),
  instructions text not null check(char_length(btrim(instructions)) between 20 and 5000),
  due_at timestamptz,
  resource_url text check(resource_url is null or (char_length(resource_url)<=1000 and resource_url ~* '^https://[^[:space:]]+$')),
  learner_id uuid references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists classroom_assignments_course on public.classroom_assignments(course_id,created_at desc,id);
create table if not exists public.classroom_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.classroom_assignments(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  details text not null check(char_length(btrim(details)) between 20 and 5000),
  evidence_url text check(evidence_url is null or (char_length(evidence_url)<=1000 and evidence_url ~* '^https://[^[:space:]]+$')),
  review_status text not null default 'submitted' check(review_status in ('submitted','revision_requested','accepted')),
  teacher_feedback text not null default '' check(char_length(teacher_feedback)<=3000),
  seen_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check((review_status='submitted')=(reviewed_at is null))
);
create unique index if not exists classroom_assignment_one_pending
  on public.classroom_assignment_submissions(assignment_id,learner_id) where review_status='submitted';
create index if not exists classroom_assignment_learner on public.classroom_assignment_submissions(learner_id,created_at desc,id);
alter table public.classroom_assignments enable row level security;
alter table public.classroom_assignment_submissions enable row level security;
revoke all on public.classroom_assignments,public.classroom_assignment_submissions from public,anon,authenticated;
grant select on public.classroom_assignments,public.classroom_assignment_submissions to authenticated;

create or replace function public.manages_classroom(p_course uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or (public.is_teacher() and exists(select 1 from public.courses
    where id=p_course and instructor_id=(select auth.uid())));
$$;
create or replace function public.can_read_classwork(p_assignment uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_approved() and exists(select 1 from public.classroom_assignments a
    where a.id=p_assignment and (public.manages_classroom(a.course_id)
      or (a.learner_id is null or a.learner_id=(select auth.uid())) and exists(
        select 1 from public.course_enrollments e where e.course_id=a.course_id and e.learner_id=(select auth.uid()))));
$$;
revoke all on function public.manages_classroom(uuid),public.can_read_classwork(uuid) from public,anon,authenticated;
grant execute on function public.manages_classroom(uuid),public.can_read_classwork(uuid) to authenticated;
drop policy if exists "Class members read assigned work" on public.classroom_assignments;
create policy "Class members read assigned work" on public.classroom_assignments for select to authenticated
  using(public.can_read_classwork(id));
drop policy if exists "Own classwork or assigned teacher" on public.classroom_assignment_submissions;
create policy "Own classwork or assigned teacher" on public.classroom_assignment_submissions for select to authenticated
  using(public.is_approved() and (learner_id=(select auth.uid()) or exists(
    select 1 from public.classroom_assignments a where a.id=assignment_id and public.manages_classroom(a.course_id))));

create or replace function public.publish_classroom_assignment(p_course uuid,p_title text,p_kind text,
  p_instructions text,p_due_at timestamptz default null,p_resource_url text default null,p_learner uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_course public.courses%rowtype; v_admin boolean;
begin
  select role='admin' into v_admin from public.profiles where id=(select auth.uid()) and membership_status='approved'
    and (role in ('teacher','admin') or role='founder' and founder_teaching_enabled) for share;
  if not found then raise exception 'Teaching access required'; end if;
  select * into v_course from public.courses where id=p_course for update;
  if not found or (not v_admin and v_course.instructor_id is distinct from (select auth.uid())) then raise exception 'Only the assigned teacher can publish classwork'; end if;
  if v_course.status<>'active' then raise exception 'Publish new work in an open class'; end if;
  if p_learner is not null then
    perform 1 from public.course_enrollments e join public.profiles p on p.id=e.learner_id
      where e.course_id=p_course and e.learner_id=p_learner and p.membership_status='approved'
        and p.role in ('member','teacher','founder','admin') for share of p,e;
    if not found then raise exception 'Choose a student enrolled in this class with approved learning access'; end if;
  end if;
  insert into public.classroom_assignments(course_id,title,kind,instructions,due_at,resource_url,learner_id,created_by)
    values(p_course,btrim(p_title),p_kind,btrim(p_instructions),p_due_at,nullif(btrim(p_resource_url),''),p_learner,(select auth.uid())) returning id into v_id;
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    select e.learner_id,'course','New classwork: '||btrim(p_title),'course',p_course
    from public.course_enrollments e join public.profiles p on p.id=e.learner_id
    where e.course_id=p_course and (p_learner is null or e.learner_id=p_learner)
      and p.membership_status='approved' and p.role in ('member','teacher','founder','admin');
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'classwork_published','course',p_course);
  return v_id;
end $$;
revoke all on function public.publish_classroom_assignment(uuid,text,text,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_classroom_assignment(uuid,text,text,text,timestamptz,text,uuid) to authenticated;

create or replace function public.submit_classroom_assignment(p_assignment uuid,p_details text,p_evidence_url text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_work public.classroom_assignments%rowtype; v_id uuid; v_teacher uuid;
begin
  perform 1 from public.profiles where id=(select auth.uid()) and membership_status='approved'
    and role in ('member','teacher','founder','admin') for share;
  if not found then raise exception 'Approved learning access required'; end if;
  select * into v_work from public.classroom_assignments where id=p_assignment for share;
  if not found or not public.can_read_classwork(p_assignment) or not exists(select 1 from public.course_enrollments
    where course_id=v_work.course_id and learner_id=(select auth.uid())) then raise exception 'Enrollment in this class is required'; end if;
  if exists(select 1 from public.classroom_assignment_submissions where assignment_id=p_assignment
    and learner_id=(select auth.uid()) and review_status in ('submitted','accepted')) then
    raise exception 'This work is awaiting review or already accepted'; end if;
  insert into public.classroom_assignment_submissions(assignment_id,learner_id,details,evidence_url)
    values(p_assignment,(select auth.uid()),btrim(p_details),nullif(btrim(p_evidence_url),'')) returning id into v_id;
  select instructor_id into v_teacher from public.courses where id=v_work.course_id;
  if v_teacher is not null and v_teacher<>(select auth.uid()) then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(v_teacher,'course','Classwork ready for review: '||v_work.title,'teacher',v_work.course_id);
  end if;
  return v_id;
end $$;
revoke all on function public.submit_classroom_assignment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_classroom_assignment(uuid,text,text) to authenticated;

create or replace function public.review_classroom_assignment(p_submission uuid,p_decision text,p_feedback text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v_submission public.classroom_assignment_submissions%rowtype; v_work public.classroom_assignments%rowtype; v_admin boolean; v_teacher uuid;
begin
  select role='admin' into v_admin from public.profiles where id=(select auth.uid()) and membership_status='approved'
    and (role in ('teacher','admin') or role='founder' and founder_teaching_enabled) for share;
  if not found then raise exception 'Teaching access required'; end if;
  select * into v_submission from public.classroom_assignment_submissions where id=p_submission for update;
  if not found then raise exception 'Submission unavailable'; end if;
  select * into v_work from public.classroom_assignments where id=v_submission.assignment_id;
  select instructor_id into v_teacher from public.courses where id=v_work.course_id for share;
  if (not v_admin and v_teacher is distinct from (select auth.uid())) or v_submission.learner_id=(select auth.uid()) then
    raise exception 'Only the assigned teacher may review another student''s work'; end if;
  if p_decision='seen' then
    update public.classroom_assignment_submissions set seen_at=coalesce(seen_at,now()) where id=p_submission;
    return;
  end if;
  if p_decision is null or p_decision not in ('accepted','revision_requested')
    or char_length(btrim(coalesce(p_feedback,''))) not between 3 and 3000 then
    raise exception 'Choose a review decision and provide useful feedback'; end if;
  if v_submission.review_status<>'submitted' then raise exception 'This attempt has already been reviewed'; end if;
  update public.classroom_assignment_submissions set review_status=p_decision,teacher_feedback=btrim(p_feedback),
    seen_at=coalesce(seen_at,now()),reviewed_by=(select auth.uid()),reviewed_at=now() where id=p_submission;
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values(v_submission.learner_id,'course','Classwork feedback: '||v_work.title,'course',v_work.course_id);
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'classwork_'||p_decision,'course',v_work.course_id);
end $$;
revoke all on function public.review_classroom_assignment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_classroom_assignment(uuid,text,text) to authenticated;

-- Classwork also counts as permanent learning history when removing a class.
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
    and not exists (select 1 from public.classroom_assignments where course_id = p_course)
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

notify pgrst,'reload schema';
commit;
