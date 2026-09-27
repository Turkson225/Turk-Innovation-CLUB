-- Run after upgrade_course_planning.sql, upgrade_teacher_materials.sql and
-- upgrade_founder_teaching_roles.sql. Keep the catalog open to approved club
-- members; only a course's learners and teaching lead see its private files.
-- Safe to rerun. Do not rerun the older teacher-materials migration afterward.

begin;

-- A private course file must never become a general-library file as a side
-- effect of deleting the workshop. Preserve the course until the material is
-- deliberately handled by an administrator.
alter table public.learning_materials
  drop constraint if exists learning_materials_course_id_fkey;
alter table public.learning_materials
  add constraint learning_materials_course_id_fkey
    foreign key (course_id) references public.courses(id) on delete restrict;

drop policy if exists "Club reads learning materials" on public.learning_materials;
create policy "Club reads learning materials" on public.learning_materials
  for select to authenticated using (
    public.is_approved()
    and (hidden_at is null or public.is_admin())
    and (
      course_id is null or public.is_admin()
      or (public.is_teacher() and exists (
        select 1 from public.courses c
         where c.id = learning_materials.course_id
           and c.instructor_id = (select auth.uid())
      ))
      or exists (
        select 1 from public.course_enrollments e
         where e.course_id = learning_materials.course_id
           and e.learner_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Teachers publish learning materials" on public.learning_materials;
create policy "Teachers publish learning materials" on public.learning_materials
  for insert to authenticated with check (
    public.is_teacher()
    and uploaded_by = (select auth.uid())
    and hidden_at is null
    and split_part(storage_path, '/', 1) = (select auth.uid()::text)
    and (
      course_id is null or public.is_admin()
      or exists (
        select 1 from public.courses c
         where c.id = learning_materials.course_id
           and c.instructor_id = (select auth.uid())
      )
    )
  );

-- The Storage API can require SELECT even when removing an unlinked upload.
-- A SECURITY DEFINER lookup checks the actual table rather than the caller's
-- filtered material rows, so a former instructor cannot delete a published
-- file merely because its course is no longer visible to them.
create or replace function public.is_unlinked_learning_file(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_teacher()
    and split_part(coalesce(p_path, ''), '/', 1) = (select auth.uid()::text)
    and not exists (
    select 1 from public.learning_materials m where m.storage_path = p_path
  );
$$;
revoke all on function public.is_unlinked_learning_file(text)
  from public, anon, authenticated;
grant execute on function public.is_unlinked_learning_file(text) to authenticated;

drop policy if exists "Club downloads learning files" on storage.objects;
create policy "Club downloads learning files" on storage.objects
  for select to authenticated using (
    bucket_id = 'club-learning' and public.is_approved() and (
      exists (
        select 1 from public.learning_materials m
         where m.storage_path = name and m.hidden_at is null
           and (
             m.course_id is null or public.is_admin()
             or (public.is_teacher() and exists (
               select 1 from public.courses c
                where c.id = m.course_id and c.instructor_id = (select auth.uid())
             ))
             or exists (
               select 1 from public.course_enrollments e
                where e.course_id = m.course_id
                  and e.learner_id = (select auth.uid())
             )
           )
      )
      or (
        public.is_teacher()
        and (storage.foldername(name))[1] = (select auth.uid()::text)
        and public.is_unlinked_learning_file(name)
      )
    )
  );

drop policy if exists "Teachers clean up own learning files" on storage.objects;
create policy "Teachers clean up own learning files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'club-learning' and public.is_teacher()
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and public.is_unlinked_learning_file(name)
  );

-- Existing workshop schedule changes use an RPC. Treat course content edits
-- the same way: course reassignment and privileged columns stay unavailable.
create or replace function public.update_course_content(
  p_course uuid,
  p_title text,
  p_category text,
  p_level text,
  p_description text,
  p_resource_url text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_course public.courses%rowtype;
  v_title text := btrim(p_title);
  v_category text := btrim(p_category);
  v_level text := btrim(p_level);
  v_description text := btrim(p_description);
  v_resource_url text := nullif(btrim(p_resource_url), '');
begin
  select p.role = 'admin' into v_admin
    from public.profiles p
   where p.id = (select auth.uid())
     and p.membership_status = 'approved'
     and (p.role in ('teacher','admin')
       or (p.role = 'founder' and p.founder_teaching_enabled))
   for share;
  if not found then raise exception 'Teacher or administrator access required'; end if;

  if v_title is null or char_length(v_title) not between 3 and 160 then
    raise exception 'Use a workshop title of 3 to 160 characters';
  end if;
  if v_category is null or v_category not in (
    'Controls and Automation','Software and Programming',
    'Electronics and Robotics','AI & Machine Learning'
  ) then raise exception 'Select one of the four learning tracks'; end if;
  if v_level is null or v_level not in ('Beginner','Intermediate','Advanced') then
    raise exception 'Choose a valid workshop level';
  end if;
  if v_description is null or char_length(v_description) not between 20 and 5000 then
    raise exception 'Describe the practical build in 20 to 5000 characters';
  end if;
  if v_resource_url is not null and (
    char_length(v_resource_url) > 1000
    or v_resource_url !~* '^https://[^[:space:]]+$'
  ) then raise exception 'Use an HTTPS resource link'; end if;

  select * into v_course from public.courses where id = p_course for update;
  if not found then raise exception 'Workshop not found'; end if;
  if not v_admin and v_course.instructor_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned teacher can edit this workshop';
  end if;
  if v_course.title is not distinct from v_title
    and v_course.category is not distinct from v_category
    and v_course.level is not distinct from v_level
    and v_course.description is not distinct from v_description
    and v_course.resource_url is not distinct from v_resource_url then return; end if;

  update public.courses set title = v_title, category = v_category,
    level = v_level, description = v_description,
    resource_url = v_resource_url where id = p_course;
  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'course_content_updated', 'course', p_course);
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    select e.learner_id, 'course', 'Workshop details updated: ' || v_title,
      'course', p_course
      from public.course_enrollments e
     where e.course_id = p_course and e.status = 'enrolled'
       and e.learner_id <> (select auth.uid());
end $$;
revoke all on function public.update_course_content(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_course_content(uuid,text,text,text,text,text)
  to authenticated;

-- Keep the notice itself generic. Build notes, feedback and evidence remain
-- restricted by the existing submissions and evidence policies.
create or replace function public.notify_course_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_teacher uuid;
  v_title text;
begin
  select c.instructor_id, c.title into v_teacher, v_title
    from public.courses c where c.id = new.course_id;
  if v_teacher is not null and v_teacher <> new.learner_id and exists (
    select 1 from public.profiles p
     where p.id = v_teacher and p.membership_status = 'approved'
       and (p.role in ('teacher','admin')
         or (p.role = 'founder' and p.founder_teaching_enabled))
  ) then
    insert into public.notifications(user_id, kind, title, target_type, target_id)
      values (v_teacher, 'course', 'Project ready for review: ' || v_title,
        'teacher', new.course_id);
  else
    -- An unassigned workshop, or a teacher submitting their own project,
    -- needs an administrator to review it.
    insert into public.notifications(user_id, kind, title, target_type, target_id)
      select p.id, 'course', 'Project ready for review: ' || v_title,
        'teacher', new.course_id
        from public.profiles p
       where p.role = 'admin' and p.membership_status = 'approved'
         and p.id <> new.learner_id;
  end if;
  return new;
end $$;
revoke all on function public.notify_course_submission()
  from public, anon, authenticated;
drop trigger if exists notify_course_submission on public.course_submissions;
create trigger notify_course_submission after insert on public.course_submissions
  for each row execute function public.notify_course_submission();

create or replace function public.notify_course_feedback()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  select c.title into v_title from public.courses c where c.id = new.course_id;
  insert into public.notifications(user_id, kind, title, target_type, target_id)
    values (new.learner_id, 'course',
      case when new.review_status = 'accepted' then 'Project accepted: '
        else 'Revision requested: ' end || v_title,
      'course', new.course_id);
  return new;
end $$;
revoke all on function public.notify_course_feedback()
  from public, anon, authenticated;
drop trigger if exists notify_course_feedback on public.course_submissions;
create trigger notify_course_feedback
  after update of review_status on public.course_submissions
  for each row
  when (old.review_status = 'submitted'
    and new.review_status in ('accepted','revision_requested'))
  execute function public.notify_course_feedback();

commit;
