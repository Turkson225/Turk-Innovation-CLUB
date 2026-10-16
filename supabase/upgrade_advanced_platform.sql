-- SPACE advanced workspaces. Run this complete file after upgrade_officer_workspaces_finance.sql.
-- Additive schema: no existing members, messages, marks or financial records are removed.
begin;
do $$ begin
 if to_regclass('public.officer_assignments') is null or to_regclass('public.classroom_assignments') is null or to_regclass('public.direct_messages') is null or to_regclass('public.project_members') is null then raise exception 'Run officer/finance, learning dashboards, direct messages and membership collaboration upgrades first';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='direct_messages' and column_name='reply_to_id') or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='direct_messages' and column_name='image_path') then raise exception 'Run the latest DM conversations and media upgrades first';end if;
end $$;
create or replace function public.space_course_access(p_course uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved() and (public.manages_classroom(p_course) or exists(select 1 from public.course_enrollments where course_id=p_course and learner_id=auth.uid()))
$$;
create or replace function public.space_event_staff() returns boolean language sql stable security definer set search_path='' as $$ select public.is_admin() or public.has_officer_role('events_coordinator') $$;
create or replace function public.space_secretary() returns boolean language sql stable security definer set search_path='' as $$ select public.is_admin() or public.has_officer_role('secretary') $$;
create or replace function public.space_project_editor(p_project uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved() and (public.is_admin() or exists(select 1 from public.projects where id=p_project and owner_id=auth.uid()) or exists(select 1 from public.project_members where project_id=p_project and user_id=auth.uid()))
$$;
create or replace function public.space_notify(p_user uuid,p_kind text,p_title text,p_target text,p_id uuid) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,kind,title,target_type,target_id) values(p_user,p_kind,left(p_title,180),p_target,p_id)
$$;

create table if not exists public.space_notification_preferences(user_id uuid primary key references public.profiles(id) on delete cascade,muted_categories text[] not null default '{}',popups boolean not null default true,sound boolean not null default false,push_enabled boolean not null default true,updated_at timestamptz not null default now());
create or replace function public.space_notification_category(p_kind text) returns text language sql immutable as $$
 select case when p_kind in ('direct_message','mention','reply','channel_message','message') then 'messages' when p_kind ~ '(course|class|lesson|learning|feedback|submission|enroll)' then 'learning' when p_kind ~ '(project|task|milestone)' then 'projects' when p_kind ~ '(event|rsvp|attendance)' then 'events' when p_kind ~ '(officer|meeting|role|office)' then 'office' else 'club' end
$$;
create or replace function public.space_save_notification_preferences(p_muted text[],p_popups boolean,p_sound boolean,p_push boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_approved() then raise exception 'Approved access required';end if;
 if p_muted is null or exists(select 1 from unnest(p_muted) v where v is null or v not in ('messages','learning','projects','events','office','club')) or p_popups is null or p_sound is null or p_push is null then raise exception 'Choose valid notification preferences';end if;
 insert into public.space_notification_preferences(user_id,muted_categories,popups,sound,push_enabled) values(auth.uid(),p_muted,p_popups,p_sound,p_push) on conflict(user_id) do update set muted_categories=excluded.muted_categories,popups=excluded.popups,sound=excluded.sound,push_enabled=excluded.push_enabled,updated_at=now();
end $$;
create or replace function public.space_guard_push_preference() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.notifications n join public.space_notification_preferences p on p.user_id=n.user_id where n.id=new.notification_id and (not p.push_enabled or public.space_notification_category(n.kind)=any(p.muted_categories))) then return null;end if;return new;
end $$;
do $$ begin if to_regclass('public.push_outbox') is not null then execute 'drop trigger if exists space_push_preferences on public.push_outbox';execute 'create trigger space_push_preferences before insert on public.push_outbox for each row execute function public.space_guard_push_preference()';end if;end $$;

create table if not exists public.space_meetings(id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title)) between 3 and 160),starts_at timestamptz not null,agenda text not null check(length(trim(agenda)) between 10 and 10000),minutes text not null default '' check(length(minutes)<=16000),status text not null default 'planned' check(status in ('planned','in_progress','completed')),meet_url text check(meet_url is null or meet_url ~ '^https://[^[:space:]]+$'),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.space_meeting_revisions(id uuid primary key default gen_random_uuid(),meeting_id uuid not null references public.space_meetings(id),actor_id uuid not null references public.profiles(id),snapshot jsonb not null,created_at timestamptz not null default now());
create table if not exists public.space_meeting_attendance(id uuid primary key default gen_random_uuid(),meeting_id uuid not null references public.space_meetings(id),user_id uuid not null references public.profiles(id),status text not null check(status in ('present','absent','excused')),recorded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(meeting_id,user_id));
create table if not exists public.space_meeting_actions(id uuid primary key default gen_random_uuid(),meeting_id uuid not null references public.space_meetings(id),assignee_id uuid not null references public.profiles(id),title text not null check(length(trim(title)) between 3 and 200),due_at date,status text not null default 'todo' check(status in ('todo','in_progress','done')),created_at timestamptz not null default now());
create or replace function public.space_save_meeting(p_id uuid,p_title text,p_start timestamptz,p_agenda text,p_minutes text,p_status text,p_url text default null) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;begin
 if not public.space_secretary() then raise exception 'Secretary or administrator access required';end if;
 if p_start is null or p_status is null or p_status not in ('planned','in_progress','completed') or p_title is null or p_agenda is null then raise exception 'Complete the meeting details';end if;
 if p_id is null then insert into public.space_meetings(title,starts_at,agenda,minutes,status,meet_url,created_by) values(trim(p_title),p_start,trim(p_agenda),coalesce(p_minutes,''),p_status,nullif(p_url,''),auth.uid()) returning id into v_id;
 else update public.space_meetings set title=trim(p_title),starts_at=p_start,agenda=trim(p_agenda),minutes=coalesce(p_minutes,''),status=p_status,meet_url=nullif(p_url,''),updated_at=now() where id=p_id returning id into v_id;if v_id is null then raise exception 'Meeting not found';end if;end if;
 insert into public.space_meeting_revisions(meeting_id,actor_id,snapshot) select id,auth.uid(),to_jsonb(m) from public.space_meetings m where id=v_id;return v_id;
end $$;
create or replace function public.space_record_meeting_attendance(p_meeting uuid,p_user uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.space_secretary() then raise exception 'Secretary or administrator access required';end if;
 if not exists(select 1 from public.profiles where id=p_user and membership_status='approved' and role<>'investor') then raise exception 'Choose an approved club member';end if;
 insert into public.space_meeting_attendance(meeting_id,user_id,status,recorded_by) values(p_meeting,p_user,p_status,auth.uid()) on conflict(meeting_id,user_id) do update set status=excluded.status,recorded_by=excluded.recorded_by;
end $$;
create or replace function public.space_save_meeting_action(p_id uuid,p_meeting uuid,p_assignee uuid,p_title text,p_due date,p_status text) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;begin
 if p_status is null or p_status not in ('todo','in_progress','done') then raise exception 'Choose a progress status';end if;
 if public.space_secretary() then
  if not exists(select 1 from public.profiles where id=p_assignee and membership_status='approved' and role<>'investor') then raise exception 'Choose an approved club member';end if;
  if p_id is null then insert into public.space_meeting_actions(meeting_id,assignee_id,title,due_at,status) values(p_meeting,p_assignee,trim(p_title),p_due,p_status) returning id into v_id;perform public.space_notify(p_assignee,'office_task','Meeting action: '||p_title,'office_meeting',p_meeting);
  else update public.space_meeting_actions set title=trim(p_title),assignee_id=p_assignee,due_at=p_due,status=p_status where id=p_id and meeting_id=p_meeting returning id into v_id;end if;
 elsif public.is_approved() then update public.space_meeting_actions set status=p_status where id=p_id and assignee_id=auth.uid() returning id into v_id;
 end if;if v_id is null then raise exception 'This action is unavailable';end if;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'meeting_action_'||p_status,'meeting_action',v_id);return v_id;
end $$;

create table if not exists public.space_course_lessons(id uuid primary key default gen_random_uuid(),course_id uuid not null references public.courses(id) on delete cascade,title text not null check(length(trim(title)) between 3 and 160),position integer not null check(position between 1 and 500),outcome text not null check(length(trim(outcome)) between 10 and 5000),instructions text not null check(length(trim(instructions)) between 10 and 10000),resource_url text check(resource_url is null or resource_url ~ '^https://[^[:space:]]+$'),created_at timestamptz not null default now(),unique(course_id,position));
create table if not exists public.space_lesson_checkins(id uuid primary key default gen_random_uuid(),lesson_id uuid not null references public.space_course_lessons(id) on delete cascade,learner_id uuid not null references public.profiles(id),done boolean not null default true,created_at timestamptz not null default now(),unique(lesson_id,learner_id));
create table if not exists public.space_class_sessions(id uuid primary key default gen_random_uuid(),course_id uuid not null references public.courses(id) on delete cascade,title text not null check(length(trim(title)) between 3 and 160),starts_at timestamptz not null,ends_at timestamptz not null,meet_url text check(meet_url is null or meet_url ~ '^https://[^[:space:]]+$'),created_at timestamptz not null default now(),check(ends_at>starts_at));
create table if not exists public.space_class_attendance(id uuid primary key default gen_random_uuid(),session_id uuid not null references public.space_class_sessions(id) on delete cascade,learner_id uuid not null references public.profiles(id),status text not null check(status in ('present','late','absent','excused')),recorded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(session_id,learner_id));
create table if not exists public.space_practical_grades(id uuid primary key default gen_random_uuid(),submission_id uuid not null unique references public.classroom_assignment_submissions(id),course_id uuid not null references public.courses(id),learner_id uuid not null references public.profiles(id),demonstration integer not null check(demonstration between 0 and 100),testing integer not null check(testing between 0 and 100),explanation integer not null check(explanation between 0 and 100),feedback text not null check(length(trim(feedback)) between 10 and 3000),graded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.space_grade_history(id uuid primary key default gen_random_uuid(),grade_id uuid not null references public.space_practical_grades(id),course_id uuid not null references public.courses(id),learner_id uuid not null references public.profiles(id),snapshot jsonb not null,created_at timestamptz not null default now());
create or replace function public.space_save_lesson(p_id uuid,p_course uuid,p_title text,p_position integer,p_outcome text,p_instructions text,p_url text default null) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;begin
 if not public.is_approved() or not public.manages_classroom(p_course) then raise exception 'Assigned teacher access required';end if;
 if p_id is null then insert into public.space_course_lessons(course_id,title,position,outcome,instructions,resource_url) values(p_course,trim(p_title),p_position,trim(p_outcome),trim(p_instructions),nullif(p_url,'')) returning id into v_id;
 else update public.space_course_lessons set title=trim(p_title),position=p_position,outcome=trim(p_outcome),instructions=trim(p_instructions),resource_url=nullif(p_url,'') where id=p_id and course_id=p_course returning id into v_id;end if;if v_id is null then raise exception 'Lesson not found';end if;return v_id;
end $$;
create or replace function public.space_check_lesson(p_lesson uuid,p_done boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if p_done is null or not public.is_approved() or not exists(select 1 from public.space_course_lessons l join public.course_enrollments e on e.course_id=l.course_id where l.id=p_lesson and e.learner_id=auth.uid()) then raise exception 'Enrollment required';end if;
 insert into public.space_lesson_checkins(lesson_id,learner_id,done) values(p_lesson,auth.uid(),p_done) on conflict(lesson_id,learner_id) do update set done=excluded.done;
end $$;
create or replace function public.space_save_class_session(p_course uuid,p_title text,p_start timestamptz,p_end timestamptz,p_url text default null) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;begin
 if not public.is_approved() or not public.manages_classroom(p_course) then raise exception 'Assigned teacher access required';end if;
 insert into public.space_class_sessions(course_id,title,starts_at,ends_at,meet_url) values(p_course,trim(p_title),p_start,p_end,nullif(p_url,'')) returning id into v_id;
 insert into public.notifications(user_id,kind,title,target_type,target_id) select learner_id,'course_session','New class session: '||p_title,'course',p_course from public.course_enrollments where course_id=p_course and status='enrolled';return v_id;
end $$;
create or replace function public.space_record_class_attendance(p_session uuid,p_learner uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$ declare v_course uuid;v_start timestamptz;begin
 select course_id,starts_at into v_course,v_start from public.space_class_sessions where id=p_session;
 if not public.is_approved() or not public.manages_classroom(v_course) then raise exception 'Assigned teacher access required';end if;
 if v_start>now()+interval '1 hour' then raise exception 'Attendance opens one hour before the session';end if;
 if not exists(select 1 from public.course_enrollments where course_id=v_course and learner_id=p_learner) then raise exception 'Choose an enrolled student';end if;
 insert into public.space_class_attendance(session_id,learner_id,status,recorded_by) values(p_session,p_learner,p_status,auth.uid()) on conflict(session_id,learner_id) do update set status=excluded.status,recorded_by=excluded.recorded_by;
end $$;
create or replace function public.space_grade_practical(p_submission uuid,p_demo integer,p_testing integer,p_explanation integer,p_feedback text) returns uuid language plpgsql security definer set search_path='' as $$ declare v_course uuid;v_learner uuid;v_status text;v_id uuid;begin
 select a.course_id,s.learner_id,s.review_status into v_course,v_learner,v_status from public.classroom_assignment_submissions s join public.classroom_assignments a on a.id=s.assignment_id where s.id=p_submission;
 if not public.is_approved() or not public.manages_classroom(v_course) or v_learner=auth.uid() then raise exception 'Assigned teacher must assess another student';end if;
 if v_status='submitted' then raise exception 'Review this submission before grading';end if;
 insert into public.space_practical_grades(submission_id,course_id,learner_id,demonstration,testing,explanation,feedback,graded_by) values(p_submission,v_course,v_learner,p_demo,p_testing,p_explanation,trim(p_feedback),auth.uid()) on conflict(submission_id) do update set demonstration=excluded.demonstration,testing=excluded.testing,explanation=excluded.explanation,feedback=excluded.feedback,graded_by=excluded.graded_by,updated_at=now() returning id into v_id;
 insert into public.space_grade_history(grade_id,course_id,learner_id,snapshot) select id,course_id,learner_id,to_jsonb(g) from public.space_practical_grades g where id=v_id;
 perform public.space_notify(v_learner,'course_grade','Practical assessment updated','course',v_course);return v_id;
end $$;

create table if not exists public.space_certificates(id uuid primary key default gen_random_uuid(),completion_id uuid not null unique references public.course_completions(id),learner_id uuid not null references public.profiles(id),course_id uuid not null references public.courses(id),recipient_name text not null,course_title text not null,public_code uuid not null unique default gen_random_uuid(),public_verification boolean not null default false,issued_at timestamptz not null default now(),revoked_at timestamptz,revocation_reason text not null default '',created_at timestamptz not null default now());
create or replace function public.space_issue_certificate(p_course uuid,p_public boolean default false) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;v_completion uuid;v_title text;v_name text;begin
 if not public.is_approved() or p_public is null then raise exception 'Approved access required';end if;
 select c.id,w.title,p.full_name into v_completion,v_title,v_name from public.course_completions c join public.courses w on w.id=c.course_id join public.profiles p on p.id=c.learner_id where c.learner_id=auth.uid() and c.course_id=p_course;
 if v_completion is null then raise exception 'A teacher-confirmed course completion is required';end if;
 insert into public.space_certificates(completion_id,learner_id,course_id,recipient_name,course_title,public_verification) values(v_completion,auth.uid(),p_course,v_name,v_title,p_public) on conflict(completion_id) do update set public_verification=excluded.public_verification returning id into v_id;return v_id;
end $$;
create or replace function public.space_revoke_certificate(p_certificate uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_admin() or length(trim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Administrator access and a reason required';end if;
 update public.space_certificates set revoked_at=now(),revocation_reason=trim(p_reason) where id=p_certificate and revoked_at is null;if not found then raise exception 'Active certificate not found';end if;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'certificate_revoked','certificate',p_certificate);
end $$;
create or replace function public.space_verify_certificate(p_code text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('code',c.public_code,'recipient_initials',(select string_agg(left(x,1)||'.',' ') from regexp_split_to_table(c.recipient_name,'\s+') x where x<>''),'course',c.course_title,'issued_at',c.issued_at,'status',case when c.revoked_at is null then 'valid' else 'revoked' end,'issuer','TURK INNOVATION CLUB') from public.space_certificates c where c.public_code::text=p_code and c.public_verification
$$;

alter table public.project_tasks drop constraint if exists project_tasks_status_check;
alter table public.project_tasks add constraint project_tasks_status_check check(status in ('todo','in_progress','review','done'));
create table if not exists public.space_project_updates(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id) on delete cascade,author_id uuid not null references public.profiles(id),body text not null check(length(trim(body)) between 10 and 5000),document_id uuid references public.documents(id),evidence_url text check(evidence_url is null or evidence_url ~ '^https://[^[:space:]]+$'),created_at timestamptz not null default now());
create or replace function public.space_move_project_task(p_task uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$ declare v_task public.project_tasks%rowtype;begin
 select * into v_task from public.project_tasks where id=p_task for update;if not found then raise exception 'Task not found';end if;
 if not public.is_approved() or not(public.space_project_editor(v_task.project_id) or v_task.assignee_id=auth.uid()) then raise exception 'Project team access required';end if;
 if p_status is null or p_status not in ('todo','in_progress','review','done') then raise exception 'Choose a board column';end if;
 update public.project_tasks set status=p_status where id=p_task;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'project_task_'||p_status,'project_task',p_task);
end $$;
create or replace function public.space_post_project_update(p_project uuid,p_body text,p_url text default null,p_document uuid default null) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;begin
 if not public.space_project_editor(p_project) then raise exception 'Project team access required';end if;
 insert into public.space_project_updates(project_id,author_id,body,evidence_url,document_id) values(p_project,auth.uid(),trim(p_body),nullif(p_url,''),p_document) returning id into v_id;return v_id;
end $$;

create table if not exists public.space_event_settings(id uuid primary key default gen_random_uuid(),event_id uuid not null unique references public.events(id) on delete cascade,capacity integer check(capacity between 1 and 100000),resources text not null default '' check(length(resources)<=5000),created_at timestamptz not null default now());
create table if not exists public.space_event_registrations(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete cascade,user_id uuid not null references public.profiles(id),status text not null check(status in ('confirmed','waitlisted','cancelled')),checked_in boolean not null default false,checked_in_at timestamptz,created_at timestamptz not null default now(),unique(event_id,user_id));
create index if not exists space_event_queue on public.space_event_registrations(event_id,status,created_at,id);
insert into public.space_event_registrations(event_id,user_id,status) select event_id,user_id,'confirmed' from public.event_rsvps where response='going' on conflict(event_id,user_id) do nothing;
create table if not exists public.space_event_feedback(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete cascade,user_id uuid not null references public.profiles(id),rating integer not null check(rating between 1 and 5),comment text not null default '' check(length(comment)<=1500),created_at timestamptz not null default now(),unique(event_id,user_id));
create or replace function public.space_save_event_program(p_event uuid,p_title text,p_description text,p_start timestamptz,p_end timestamptz,p_location text,p_url text,p_capacity integer,p_resources text) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;v_confirmed bigint;v_person uuid;begin
 if not public.space_event_staff() then raise exception 'Event coordinator or administrator access required';end if;
 if p_title is null or length(trim(p_title)) not between 3 and 160 or length(coalesce(p_description,''))>10000 or length(coalesce(p_location,''))>300 or p_start is null or p_end is null or p_end<=p_start or (nullif(p_url,'') is not null and p_url !~ '^https://[^[:space:]]+$') then raise exception 'Complete valid event details';end if;
 if p_event is not null then perform 1 from public.events where id=p_event for update;if not found then raise exception 'Event not found';end if;select count(*) into v_confirmed from public.space_event_registrations where event_id=p_event and status='confirmed';if p_capacity is not null and p_capacity<v_confirmed then raise exception 'Capacity cannot be lower than confirmed registrations';end if;
 update public.events set title=trim(p_title),description=coalesce(p_description,''),starts_at=p_start,ends_at=p_end,location=coalesce(p_location,'Online'),meet_url=nullif(p_url,'') where id=p_event returning id into v_id;
 else insert into public.events(title,description,starts_at,ends_at,location,meet_url) values(trim(p_title),coalesce(p_description,''),p_start,p_end,coalesce(p_location,'Online'),nullif(p_url,'')) returning id into v_id;end if;
 insert into public.space_event_settings(event_id,capacity,resources) values(v_id,p_capacity,coalesce(p_resources,'')) on conflict(event_id) do update set capacity=excluded.capacity,resources=excluded.resources;
 select count(*) into v_confirmed from public.space_event_registrations where event_id=v_id and status='confirmed';
 for v_person in select user_id from public.space_event_registrations where event_id=v_id and status='waitlisted' order by created_at,id limit case when p_capacity is null then 100000 else greatest(0,p_capacity-v_confirmed)::integer end for update loop
 update public.space_event_registrations set status='confirmed' where event_id=v_id and user_id=v_person;perform public.space_notify(v_person,'event_place','An event place is available: your registration is confirmed','event',v_id);
 end loop;return v_id;
end $$;
create or replace function public.space_register_event(p_event uuid,p_cancel boolean default false) returns text language plpgsql security definer set search_path='' as $$ declare v_capacity integer;v_count bigint;v_status text;v_promoted uuid;begin
 if not public.is_approved() or p_cancel is null then raise exception 'Approved access required';end if;
 perform 1 from public.events where id=p_event and ends_at>now() for update;if not found then raise exception 'Registration has ended';end if;
 select capacity into v_capacity from public.space_event_settings where event_id=p_event;
 select status into v_status from public.space_event_registrations where event_id=p_event and user_id=auth.uid();
 if p_cancel then
 update public.space_event_registrations set status='cancelled',checked_in=false,checked_in_at=null where event_id=p_event and user_id=auth.uid();
 if v_status='confirmed' then select user_id into v_promoted from public.space_event_registrations where event_id=p_event and status='waitlisted' order by created_at,id limit 1 for update;
 if v_promoted is not null then update public.space_event_registrations set status='confirmed' where event_id=p_event and user_id=v_promoted;perform public.space_notify(v_promoted,'event_place','A place is available: your event registration is confirmed','event',p_event);end if;end if;return 'cancelled';
 end if;
 if v_status in ('confirmed','waitlisted') then return v_status;end if;
 select count(*) into v_count from public.space_event_registrations where event_id=p_event and status='confirmed';v_status:=case when v_capacity is null or v_count<v_capacity then 'confirmed' else 'waitlisted' end;
 insert into public.space_event_registrations(event_id,user_id,status) values(p_event,auth.uid(),v_status) on conflict(event_id,user_id) do update set status=excluded.status,created_at=now();return v_status;
end $$;
create or replace function public.space_event_summary(p_event uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.is_approved() then jsonb_build_object('confirmed',(select count(*) from public.space_event_registrations where event_id=p_event and status='confirmed'),'waiting',(select count(*) from public.space_event_registrations where event_id=p_event and status='waitlisted'),'mine',(select status from public.space_event_registrations where event_id=p_event and user_id=auth.uid()),'capacity',(select capacity from public.space_event_settings where event_id=p_event)) end
$$;
create or replace function public.space_checkin_event(p_event uuid,p_user uuid,p_present boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.space_event_staff() or p_present is null then raise exception 'Event coordinator or administrator access required';end if;
 if not exists(select 1 from public.events where id=p_event and starts_at<=now()+interval '1 hour') then raise exception 'Check-in opens one hour before the event';end if;
 update public.space_event_registrations set checked_in=p_present,checked_in_at=case when p_present then now() else null end where event_id=p_event and user_id=p_user and status='confirmed';if not found then raise exception 'A confirmed registration is required';end if;
end $$;
create or replace function public.space_review_event(p_event uuid,p_rating integer,p_comment text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_approved() or not exists(select 1 from public.space_event_registrations r join public.events e on e.id=r.event_id where r.event_id=p_event and r.user_id=auth.uid() and r.checked_in and e.ends_at<=now()) then raise exception 'Feedback opens after an attended event';end if;
 insert into public.space_event_feedback(event_id,user_id,rating,comment) values(p_event,auth.uid(),p_rating,coalesce(p_comment,'')) on conflict(event_id,user_id) do update set rating=excluded.rating,comment=excluded.comment;
end $$;

create table if not exists public.space_finance_followups(id uuid primary key default gen_random_uuid(),review_id uuid not null references public.finance_monthly_reviews(id),status text not null check(status in ('open','resolved')),note text not null check(length(trim(note)) between 10 and 3000),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
drop trigger if exists space_finance_followup_immutable on public.space_finance_followups;
create trigger space_finance_followup_immutable before update or delete on public.space_finance_followups for each row execute function public.reject_club_ledger_change();
create or replace function public.space_finance_followup(p_review uuid,p_status text,p_note text) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 insert into public.space_finance_followups(review_id,status,note,created_by) values(p_review,p_status,trim(p_note),auth.uid()) returning id into v_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'finance_followup_'||p_status,'finance_month',p_review);return v_id;
end $$;

-- Private conversations: client request tokens make retries idempotent.
alter table public.direct_messages add column if not exists client_token uuid;
alter table public.direct_messages add column if not exists has_document boolean not null default false;
create unique index if not exists space_dm_retry_unique on public.direct_messages(sender_id,client_token) where client_token is not null;
create table if not exists public.space_dm_pins(id uuid primary key default gen_random_uuid(),message_id uuid not null unique references public.direct_messages(id) on delete cascade,pinned_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create table if not exists public.space_dm_files(id uuid primary key default gen_random_uuid(),message_id uuid not null unique references public.direct_messages(id) on delete cascade,sender_id uuid not null references public.profiles(id),recipient_id uuid not null references public.profiles(id),storage_path text not null unique,file_name text not null check(length(file_name) between 1 and 160),file_size bigint not null check(file_size between 1 and 10485760),mime_type text not null check(mime_type in ('application/pdf','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation')),created_at timestamptz not null default now());
create or replace function public.space_dm_participant(p_message uuid) returns boolean language sql stable security definer set search_path='' as $$ select public.is_approved() and exists(select 1 from public.direct_messages where id=p_message and auth.uid() in (sender_id,recipient_id)) $$;
create or replace function public.space_dm_file_access(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select public.is_approved() and exists(select 1 from public.space_dm_files where storage_path=p_path and auth.uid() in (sender_id,recipient_id)) $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('club-direct-files','club-direct-files',false,10485760,array['application/pdf','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists space_dm_file_read on storage.objects;create policy space_dm_file_read on storage.objects for select to authenticated using(bucket_id='club-direct-files' and public.space_dm_file_access(name));
drop policy if exists space_dm_file_insert on storage.objects;create policy space_dm_file_insert on storage.objects for insert to authenticated with check(bucket_id='club-direct-files' and public.is_approved() and split_part(name,'/',1)=auth.uid()::text and exists(select 1 from public.profiles where id::text=split_part(name,'/',2) and membership_status='approved' and role in ('member','teacher','founder','admin')));
drop policy if exists space_dm_file_cleanup on storage.objects;create policy space_dm_file_cleanup on storage.objects for delete to authenticated using(bucket_id='club-direct-files' and public.is_approved() and split_part(name,'/',1)=auth.uid()::text and not exists(select 1 from public.space_dm_files where storage_path=name));
create or replace function public.space_send_dm(p_peer uuid,p_body text,p_reply uuid,p_image text,p_token uuid,p_path text default null,p_name text default null,p_size bigint default null,p_mime text default null) returns public.direct_messages language plpgsql security definer set search_path='' as $$ declare v_row public.direct_messages%rowtype;begin
 if not public.is_approved() or p_peer=auth.uid() or p_token is null or p_peer is null or not exists(select 1 from public.profiles where id=p_peer and membership_status='approved' and role in ('member','teacher','founder','admin')) then raise exception 'Choose an approved conversation partner';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext(p_token::text));
 select * into v_row from public.direct_messages where sender_id=auth.uid() and client_token=p_token;if found then if v_row.recipient_id<>p_peer or v_row.body<>trim(p_body) then raise exception 'This message request was already used; reopen the conversation';end if;return v_row;end if;
 if p_body is null or length(trim(p_body)) not between 1 and 3000 then raise exception 'Enter a message';end if;
 if p_reply is not null and not exists(select 1 from public.direct_messages where id=p_reply and ((sender_id=auth.uid() and recipient_id=p_peer) or(sender_id=p_peer and recipient_id=auth.uid()))) then raise exception 'Reply must belong to this conversation';end if;
 if p_image is not null and (p_path is not null or split_part(p_image,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='club-media' and name=p_image)) then raise exception 'Image upload is unavailable';end if;
 if p_path is not null and (p_path not like auth.uid()::text||'/'||p_peer::text||'/%' or p_name is null or p_size is null or p_mime is null or not exists(select 1 from storage.objects where bucket_id='club-direct-files' and name=p_path and metadata->>'size'=p_size::text and metadata->>'mimetype'=p_mime)) then raise exception 'File upload could not be verified';end if;
 insert into public.direct_messages(sender_id,recipient_id,body,reply_to_id,image_path,client_token,has_document) values(auth.uid(),p_peer,trim(p_body),p_reply,p_image,p_token,p_path is not null) returning * into v_row;
 if p_path is not null then insert into public.space_dm_files(message_id,sender_id,recipient_id,storage_path,file_name,file_size,mime_type) values(v_row.id,auth.uid(),p_peer,p_path,p_name,p_size,p_mime);end if;return v_row;
end $$;
create or replace function public.space_pin_dm(p_message uuid,p_pin boolean) returns void language plpgsql security definer set search_path='' as $$ declare v_peer uuid;v_count bigint;begin
 if not public.space_dm_participant(p_message) or p_pin is null then raise exception 'Conversation access required';end if;
 select case when sender_id=auth.uid() then recipient_id else sender_id end into v_peer from public.direct_messages where id=p_message;
 perform pg_advisory_xact_lock(hashtext(least(auth.uid(),v_peer)::text),hashtext(greatest(auth.uid(),v_peer)::text));
 if p_pin then select count(*) into v_count from public.space_dm_pins p join public.direct_messages m on m.id=p.message_id where (m.sender_id=auth.uid() and m.recipient_id=v_peer) or(m.recipient_id=auth.uid() and m.sender_id=v_peer);if v_count>=20 and not exists(select 1 from public.space_dm_pins where message_id=p_message) then raise exception 'Unpin a message before adding another (maximum 20)';end if;insert into public.space_dm_pins(message_id,pinned_by) values(p_message,auth.uid()) on conflict(message_id) do nothing;
 else delete from public.space_dm_pins where message_id=p_message;end if;
end $$;
create or replace function public.space_conversation_assets(p_peer uuid,p_offset integer default 0,p_limit integer default 40) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare v_pins jsonb;v_files jsonb;v_total bigint;begin
 if not public.is_approved() or p_peer is null or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Invalid conversation page';end if;
 select coalesce(jsonb_agg(x),'[]') into v_pins from(select m.id,m.body,m.sender_id,m.recipient_id,m.created_at,m.image_path,m.has_document from public.direct_messages m join public.space_dm_pins p on p.message_id=m.id where (m.sender_id=auth.uid() and m.recipient_id=p_peer) or(m.recipient_id=auth.uid() and m.sender_id=p_peer) order by p.created_at desc limit 20)x;
 select count(*) into v_total from public.space_dm_files where (sender_id=auth.uid() and recipient_id=p_peer) or(recipient_id=auth.uid() and sender_id=p_peer);
 select coalesce(jsonb_agg(x),'[]') into v_files from(select * from public.space_dm_files where (sender_id=auth.uid() and recipient_id=p_peer) or(recipient_id=auth.uid() and sender_id=p_peer) order by created_at desc,id limit p_limit offset p_offset)x;
 return jsonb_build_object('pins',v_pins,'files',v_files,'total',v_total);
end $$;

create or replace function public.space_message_file(p_message uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not public.space_dm_participant(p_message) then raise exception 'Conversation access required';end if;
 return (select to_jsonb(f) from public.space_dm_files f where f.message_id=p_message);
end $$;
update public.direct_messages m set has_document=true from public.space_dm_files f where f.message_id=m.id and not m.has_document;

create or replace function public.space_event_summaries(p_events uuid[]) returns table(event_id uuid,confirmed bigint,waiting bigint,capacity integer) language plpgsql stable security definer set search_path='' as $$ begin
 if not public.is_approved() or p_events is null or cardinality(p_events)>100 then raise exception 'Choose up to 100 event IDs';end if;
 return query select e.id,(select count(*) from public.space_event_registrations r where r.event_id=e.id and r.status='confirmed'),(select count(*) from public.space_event_registrations r where r.event_id=e.id and r.status='waitlisted'),s.capacity from public.events e left join public.space_event_settings s on s.event_id=e.id where e.id=any(p_events);
end $$;

-- Select-only tables. Every write uses the explicit authorization checks above.
do $$ declare t text;begin foreach t in array array['space_notification_preferences','space_meetings','space_meeting_revisions','space_meeting_attendance','space_meeting_actions','space_course_lessons','space_lesson_checkins','space_class_sessions','space_class_attendance','space_practical_grades','space_grade_history','space_certificates','space_project_updates','space_event_settings','space_event_registrations','space_event_feedback','space_finance_followups','space_dm_pins','space_dm_files'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('drop policy if exists space_read on public.%I',t);
 end loop;end $$;
create policy space_read on public.space_notification_preferences for select to authenticated using(user_id=auth.uid() and public.is_approved());
create policy space_read on public.space_meetings for select to authenticated using(public.is_approved());
create policy space_read on public.space_meeting_revisions for select to authenticated using(public.space_secretary());
create policy space_read on public.space_meeting_attendance for select to authenticated using(public.space_secretary() or user_id=auth.uid() and public.is_approved());
create policy space_read on public.space_meeting_actions for select to authenticated using(public.space_secretary() or assignee_id=auth.uid() and public.is_approved());
create policy space_read on public.space_course_lessons for select to authenticated using(public.space_course_access(course_id));
create policy space_read on public.space_lesson_checkins for select to authenticated using(public.is_approved() and (learner_id=auth.uid() or exists(select 1 from public.space_course_lessons l where l.id=lesson_id and public.manages_classroom(l.course_id))));
create policy space_read on public.space_class_sessions for select to authenticated using(public.space_course_access(course_id));
create policy space_read on public.space_class_attendance for select to authenticated using(public.is_approved() and (learner_id=auth.uid() or exists(select 1 from public.space_class_sessions s where s.id=session_id and public.manages_classroom(s.course_id))));
create policy space_read on public.space_practical_grades for select to authenticated using(public.is_approved() and (learner_id=auth.uid() or public.manages_classroom(course_id)));
create policy space_read on public.space_grade_history for select to authenticated using(public.is_approved() and (learner_id=auth.uid() or public.manages_classroom(course_id)));
create policy space_read on public.space_certificates for select to authenticated using(public.is_approved() and (learner_id=auth.uid() or public.manages_classroom(course_id)));
create policy space_read on public.space_project_updates for select to authenticated using(public.is_approved());
create policy space_read on public.space_event_settings for select to authenticated using(public.is_approved());
create policy space_read on public.space_event_registrations for select to authenticated using(public.space_event_staff() or user_id=auth.uid() and public.is_approved());
create policy space_read on public.space_event_feedback for select to authenticated using(public.space_event_staff() or user_id=auth.uid() and public.is_approved());
create policy space_read on public.space_finance_followups for select to authenticated using(public.is_admin());
create policy space_read on public.space_dm_pins for select to authenticated using(public.space_dm_participant(message_id));
create policy space_read on public.space_dm_files for select to authenticated using(public.is_approved() and auth.uid() in (sender_id,recipient_id));
create index if not exists space_meeting_due on public.space_meeting_actions(assignee_id,status,due_at);
create index if not exists space_lesson_course on public.space_course_lessons(course_id,position);
create index if not exists space_session_course on public.space_class_sessions(course_id,starts_at);
create index if not exists space_grade_learner on public.space_practical_grades(learner_id,course_id);
create index if not exists space_dm_files_pair on public.space_dm_files(sender_id,recipient_id,created_at desc);
create index if not exists space_project_updates_recent on public.space_project_updates(project_id,created_at desc);
-- Keep internal notification and trigger helpers non-callable through the API.
do $$ declare r record;begin for r in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['space_check_lesson','space_checkin_event','space_conversation_assets','space_course_access','space_dm_file_access','space_dm_participant','space_event_staff','space_event_summaries','space_event_summary','space_finance_followup','space_grade_practical','space_guard_push_preference','space_issue_certificate','space_message_file','space_move_project_task','space_notification_category','space_notify','space_pin_dm','space_post_project_update','space_project_editor','space_record_class_attendance','space_record_meeting_attendance','space_register_event','space_review_event','space_revoke_certificate','space_save_class_session','space_save_event_program','space_save_lesson','space_save_meeting','space_save_meeting_action','space_save_notification_preferences','space_secretary','space_send_dm','space_verify_certificate']) loop
 execute format('revoke all on function public.%I(%s) from public,anon,authenticated',r.proname,r.args);
 if r.proname not in ('space_notify','space_guard_push_preference') then execute format('grant execute on function public.%I(%s) to authenticated',r.proname,r.args);end if;
 end loop;end $$;
grant execute on function public.space_verify_certificate(text) to anon;
commit;
