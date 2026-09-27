-- Run after upgrade_roles_investors.sql and upgrade_teacher_materials.sql.
-- Learning records and project evidence remain private to the learner, assigned teacher and administrator.

alter table public.courses add column if not exists instructor_id uuid references public.profiles(id) on delete set null;
alter table public.courses alter column instructor_id set default auth.uid();
revoke insert on public.courses from authenticated;
grant insert(title,category,level,description,starts_at,resource_url) on public.courses to authenticated;
drop policy if exists "Admins publish courses" on public.courses;
drop policy if exists "Teachers publish courses" on public.courses;
create policy "Teachers publish courses" on public.courses for insert to authenticated
  with check (public.is_teacher() and instructor_id=(select auth.uid())
    and category in ('Controls and Automation','Software and Programming','Electronics and Robotics','AI & Machine Learning'));

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'enrolled' check (status in ('enrolled','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(course_id,learner_id),
  check ((status='completed')=(completed_at is not null))
);
create index if not exists course_enrollments_learner_recent on public.course_enrollments(learner_id,created_at desc);
create index if not exists course_enrollments_course_recent on public.course_enrollments(course_id,created_at desc);
alter table public.course_enrollments enable row level security;
revoke all on public.course_enrollments from public,anon,authenticated;
grant select on public.course_enrollments to authenticated;
grant insert(course_id,learner_id) on public.course_enrollments to authenticated;
drop policy if exists "Learners and teachers read enrollments" on public.course_enrollments;
create policy "Learners and teachers read enrollments" on public.course_enrollments for select to authenticated
  using (public.is_approved() and (learner_id=(select auth.uid()) or public.is_admin()
    or (public.is_teacher() and exists(select 1 from public.courses c
      where c.id=course_id and c.instructor_id=(select auth.uid())))));
drop policy if exists "Approved learners enroll themselves" on public.course_enrollments;
create policy "Approved learners enroll themselves" on public.course_enrollments for insert to authenticated
  with check (public.is_approved() and learner_id=(select auth.uid())
    and status='enrolled' and completed_at is null);

create table if not exists public.course_submissions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  details text not null check (char_length(btrim(details)) between 20 and 5000),
  evidence_url text check (evidence_url is null or (char_length(evidence_url)<=1000 and evidence_url ~* '^https://[^[:space:]]+$')),
  evidence_path text unique,
  evidence_name text check (evidence_name is null or char_length(evidence_name) between 1 and 240),
  review_status text not null default 'submitted' check (review_status in ('submitted','revision_requested','accepted')),
  teacher_feedback text not null default '' check (char_length(teacher_feedback)<=3000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((evidence_path is null)=(evidence_name is null)),
  check ((review_status='submitted')=(reviewed_at is null))
);
create unique index if not exists course_submissions_one_pending on public.course_submissions(course_id,learner_id)
  where review_status='submitted';
create index if not exists course_submissions_course_recent on public.course_submissions(course_id,created_at desc);
create index if not exists course_submissions_learner_recent on public.course_submissions(learner_id,created_at desc);
alter table public.course_submissions enable row level security;
revoke all on public.course_submissions from public,anon,authenticated;
grant select on public.course_submissions to authenticated;
grant insert(course_id,learner_id,details,evidence_url,evidence_path,evidence_name) on public.course_submissions to authenticated;
drop policy if exists "Learners and teachers read submissions" on public.course_submissions;
create policy "Learners and teachers read submissions" on public.course_submissions for select to authenticated
  using (public.is_approved() and (learner_id=(select auth.uid()) or public.is_admin()
    or (public.is_teacher() and exists(select 1 from public.courses c
      where c.id=course_id and c.instructor_id=(select auth.uid())))));
drop policy if exists "Learners submit enrolled projects" on public.course_submissions;
create policy "Learners submit enrolled projects" on public.course_submissions for insert to authenticated
  with check (public.is_approved() and learner_id=(select auth.uid())
    and review_status='submitted' and teacher_feedback='' and reviewed_by is null and reviewed_at is null
    and (evidence_path is null or split_part(evidence_path,'/',1)=(select auth.uid()::text))
    and (evidence_path is null or split_part(evidence_path,'/',2)=course_id::text)
    and exists(select 1 from public.course_enrollments e
      where e.course_id=course_submissions.course_id and e.learner_id=(select auth.uid()) and e.status='enrolled'));

-- Serialize submissions with teacher decisions so a late attempt cannot enter after completion.
create or replace function public.lock_course_enrollment_before_submission()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  select e.status into v_status from public.course_enrollments e
    where e.course_id=new.course_id and e.learner_id=new.learner_id for update;
  if v_status is distinct from 'enrolled' then raise exception 'An active enrollment is required'; end if;
  return new;
end $$;
drop trigger if exists lock_course_enrollment_before_submission on public.course_submissions;
create trigger lock_course_enrollment_before_submission before insert on public.course_submissions
  for each row execute function public.lock_course_enrollment_before_submission();
revoke all on function public.lock_course_enrollment_before_submission() from public,anon,authenticated;

create table if not exists public.course_completions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  submission_id uuid not null unique references public.course_submissions(id) on delete cascade,
  assessed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(course_id,learner_id)
);
create index if not exists course_completions_learner_recent on public.course_completions(learner_id,completed_at desc);
alter table public.course_completions enable row level security;
revoke all on public.course_completions from public,anon,authenticated;
grant select on public.course_completions to authenticated;
drop policy if exists "Learners and teachers read completions" on public.course_completions;
create policy "Learners and teachers read completions" on public.course_completions for select to authenticated
  using (public.is_approved() and (learner_id=(select auth.uid()) or public.is_admin()
    or (public.is_teacher() and exists(select 1 from public.courses c
      where c.id=course_id and c.instructor_id=(select auth.uid())))));

create or replace function public.review_course_submission(p_submission uuid,p_decision text,p_feedback text)
returns void language plpgsql security definer set search_path='' as $$
declare v_submission public.course_submissions%rowtype;v_instructor uuid;v_enrollment public.course_enrollments%rowtype;
begin
  if not public.is_teacher() then raise exception 'Teacher access required'; end if;
  if p_decision not in ('accepted','revision_requested') then raise exception 'Choose a valid review decision'; end if;
  if char_length(btrim(coalesce(p_feedback,'')))<5 or char_length(p_feedback)>3000 then
    raise exception 'Write feedback of 5 to 3000 characters';
  end if;
  select * into v_submission from public.course_submissions where id=p_submission;
  if not found then raise exception 'Submission not found'; end if;
  select instructor_id into v_instructor from public.courses where id=v_submission.course_id for share;
  if not public.is_admin() and v_instructor is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher may review this workshop';
  end if;
  if v_submission.learner_id=(select auth.uid()) then raise exception 'You cannot review your own work'; end if;
  select * into v_enrollment from public.course_enrollments
    where course_id=v_submission.course_id and learner_id=v_submission.learner_id for update;
  if not found or v_enrollment.status<>'enrolled' then raise exception 'Learner is not actively enrolled'; end if;
  select * into v_submission from public.course_submissions where id=p_submission for update;
  if v_submission.review_status<>'submitted' then raise exception 'This attempt has already been reviewed'; end if;
  update public.course_submissions set review_status=p_decision,teacher_feedback=btrim(p_feedback),
    reviewed_by=(select auth.uid()),reviewed_at=now() where id=p_submission;
  if p_decision='accepted' then
    update public.course_enrollments set status='completed',completed_at=now() where id=v_enrollment.id;
    insert into public.course_completions(course_id,learner_id,submission_id,assessed_by)
      values(v_submission.course_id,v_submission.learner_id,p_submission,(select auth.uid()));
  end if;
end $$;
revoke all on function public.review_course_submission(uuid,text,text) from public,anon;
grant execute on function public.review_course_submission(uuid,text,text) to authenticated;

-- The dashboard editor can assign an instructor to workshops created before this migration.
create or replace function public.assign_course_instructor(p_course uuid,p_teacher uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_teacher
    and p.membership_status='approved' and p.role in ('teacher','admin')) then
    raise exception 'Select an approved teacher';
  end if;
  update public.courses set instructor_id=p_teacher where id=p_course;
  if not found then raise exception 'Workshop not found'; end if;
end $$;
revoke all on function public.assign_course_instructor(uuid,uuid) from public,anon;
grant execute on function public.assign_course_instructor(uuid,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('club-course-evidence','club-course-evidence',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Learners upload course evidence" on storage.objects;
create policy "Learners upload course evidence" on storage.objects for insert to authenticated
  with check (bucket_id='club-course-evidence' and public.is_approved()
    and (storage.foldername(name))[1]=(select auth.uid()::text)
    and exists(select 1 from public.course_enrollments e
      where e.learner_id=(select auth.uid()) and e.course_id::text=(storage.foldername(name))[2] and e.status='enrolled'));
drop policy if exists "Learners and teachers download course evidence" on storage.objects;
create policy "Learners and teachers download course evidence" on storage.objects for select to authenticated
  using (bucket_id='club-course-evidence' and public.is_approved() and (
    (storage.foldername(name))[1]=(select auth.uid()::text)
    or exists(select 1 from public.course_submissions s join public.courses c on c.id=s.course_id
      where s.evidence_path=name and (public.is_admin() or
        (public.is_teacher() and c.instructor_id=(select auth.uid()))))));
drop policy if exists "Learners clean up unsubmitted course evidence" on storage.objects;
create policy "Learners clean up unsubmitted course evidence" on storage.objects for delete to authenticated
  using (bucket_id='club-course-evidence' and public.is_approved()
    and (storage.foldername(name))[1]=(select auth.uid()::text)
    and not exists(select 1 from public.course_submissions s where s.evidence_path=name));
