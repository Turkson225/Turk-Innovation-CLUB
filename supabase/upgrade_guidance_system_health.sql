-- Run after the existing SPACE course, membership and notification upgrades.
-- Additive/rerunnable. No application records, jobs, files or secrets are removed.
begin;

create table if not exists public.space_client_issue_reports (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check(category in ('upload','notifications')),
  code text not null check(code in ('network','permission','configuration','unavailable','unknown')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  primary key(user_id,category)
);
create index if not exists space_client_issue_unreviewed on public.space_client_issue_reports(category,last_seen_at) where reviewed_at is null;
alter table public.space_client_issue_reports enable row level security;
revoke all on public.space_client_issue_reports from public,anon,authenticated;

-- Store fixed categories only: never filenames, message text, email addresses,
-- push endpoints, credentials, raw errors or document paths. At most two rows
-- per account, with repeated reports suppressed for one minute.
create or replace function public.space_report_client_issue(p_category text,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_approved() then raise exception 'Approved account required';end if;
 if p_category not in ('upload','notifications') or p_category is null
    or p_code not in ('network','permission','configuration','unavailable','unknown') or p_code is null then raise exception 'Invalid issue category';end if;
 insert into public.space_client_issue_reports(user_id,category,code)
 values(auth.uid(),p_category,p_code)
 on conflict(user_id,category) do update set code=excluded.code,last_seen_at=now(),reviewed_at=null,reviewed_by=null
 where space_client_issue_reports.last_seen_at<now()-interval '1 minute' or space_client_issue_reports.reviewed_at is not null;
end $$;
revoke all on function public.space_report_client_issue(text,text) from public,anon;
grant execute on function public.space_report_client_issue(text,text) to authenticated;

create or replace function public.space_admin_review_client_issues(p_category text,p_before timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_category is null or p_category not in ('upload','notifications') or p_before is null or p_before>now()+interval '5 seconds' then raise exception 'Invalid review boundary';end if;
 update public.space_client_issue_reports set reviewed_at=now(),reviewed_by=auth.uid()
 where category=p_category and reviewed_at is null and last_seen_at<=p_before;
 get diagnostics v_count=row_count;return v_count;
end $$;
revoke all on function public.space_admin_review_client_issues(text,timestamptz) from public,anon;
grant execute on function public.space_admin_review_client_issues(text,timestamptz) to authenticated;

-- Own-account checklist facts. Missing optional migrations return JSON null,
-- so an unavailable check is never presented as a completed task.
create or replace function public.space_onboarding_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_id uuid:=auth.uid();v_role text;v_teacher boolean;v_result jsonb;v_done boolean;
begin
 if v_id is null or not public.is_approved() then raise exception 'Approved account required';end if;
 select role into v_role from public.profiles where id=v_id;
 v_teacher:=public.is_teacher();
 v_result:=jsonb_build_object('tracks',null,'enrolled',null,'first_post',null,'teaching_profile',null,'signature',null,'published_course',null,'materials',null,'assignment',null);
 if to_regclass('public.member_learning_paths') is not null then
  execute 'select exists(select 1 from public.member_learning_paths where user_id=$1 and cardinality(tracks)>0)' into v_done using v_id;
  v_result:=v_result||jsonb_build_object('tracks',v_done);
 end if;
 if to_regclass('public.course_enrollments') is not null then
  execute 'select exists(select 1 from public.course_enrollments where learner_id=$1)' into v_done using v_id;
  v_result:=v_result||jsonb_build_object('enrolled',v_done);
 end if;
 if to_regclass('public.activity_posts') is not null and v_role<>'investor' then
  execute 'select exists(select 1 from public.activity_posts p where author_id=$1 and to_jsonb(p)->>''deleted_at'' is null)' into v_done using v_id;
  v_result:=v_result||jsonb_build_object('first_post',v_done);
 end if;
 if v_teacher then
  if to_regclass('public.teacher_profiles') is not null then
   execute 'select exists(select 1 from public.teacher_profiles where teacher_id=$1)' into v_done using v_id;
   v_result:=v_result||jsonb_build_object('teaching_profile',v_done);
  end if;
  if to_regclass('public.space_certificate_signatories') is not null then
   execute 'select exists(select 1 from public.space_certificate_signatories where user_id=$1 and consent_at is not null)' into v_done using v_id;
   v_result:=v_result||jsonb_build_object('signature',v_done);
  end if;
  if to_regclass('public.courses') is not null then
   execute 'select exists(select 1 from public.courses c where instructor_id=$1 and coalesce(to_jsonb(c)->>''status'',''open'')<>''archived'')' into v_done using v_id;
   v_result:=v_result||jsonb_build_object('published_course',v_done);
  end if;
  if to_regclass('public.learning_materials') is not null then
   execute 'select exists(select 1 from public.learning_materials m join public.courses c on c.id=m.course_id where c.instructor_id=$1 and m.uploaded_by=$1 and to_jsonb(m)->>''hidden_at'' is null)' into v_done using v_id;
   v_result:=v_result||jsonb_build_object('materials',v_done);
  end if;
  if to_regclass('public.classroom_assignments') is not null then
   execute 'select exists(select 1 from public.classroom_assignments a join public.courses c on c.id=a.course_id where c.instructor_id=$1)' into v_done using v_id;
   v_result:=v_result||jsonb_build_object('assignment',v_done);
  end if;
 end if;
 return v_result;
end $$;
revoke all on function public.space_onboarding_status() from public,anon;
grant execute on function public.space_onboarding_status() to authenticated;

-- Aggregate delivery status only. No recipient identities, endpoint URLs,
-- VAPID/SMTP secrets or raw provider messages leave this function.
create or replace function public.space_admin_system_health()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_checks jsonb:='[]';v_email jsonb;v_push jsonb;v_uploads jsonb;v_notices jsonb;
 v_name text;v_present boolean;v_count integer;v_active integer;v_jobs jsonb;v_storage jsonb;v_security boolean;
begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 foreach v_name in array array['course_enrollments','classroom_assignments','space_course_lessons','space_class_sessions','space_certificates','space_certificate_signatories','application_answers'] loop
  v_present:=to_regclass('public.'||v_name) is not null;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('key',v_name,'present',v_present));
 end loop;
 if to_regclass('public.approval_email_outbox') is not null then
  execute $q$select jsonb_build_object('pending',count(*) filter(where status in ('pending','retry')),'processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed'),'overdue',count(*) filter(where (status in ('pending','retry') and next_attempt_at<now()-interval '10 minutes') or (status='processing' and locked_at<now()-interval '10 minutes')),'sent_24h',count(*) filter(where status='sent' and sent_at>now()-interval '24 hours'),'last_sent_at',max(sent_at)) from public.approval_email_outbox$q$ into v_email;
 end if;
 if to_regclass('public.push_outbox') is not null then
  execute $q$select jsonb_build_object('pending',count(*) filter(where status in ('pending','retry')),'processing',count(*) filter(where status='processing'),'failed_24h',count(*) filter(where status='failed' and created_at>now()-interval '24 hours'),'overdue',count(*) filter(where (status in ('pending','retry') and next_attempt_at<now()-interval '10 minutes') or (status='processing' and locked_at<now()-interval '10 minutes')),'sent_24h',count(*) filter(where status='sent' and sent_at>now()-interval '24 hours'),'last_sent_at',max(sent_at)) from public.push_outbox$q$ into v_push;
 end if;
 if to_regclass('public.push_subscriptions') is not null and v_push is not null then
  execute 'select count(*)::integer from public.push_subscriptions' into v_count;
  v_push:=coalesce(v_push,'{}')||jsonb_build_object('registered_devices',v_count);
 end if;
 select jsonb_build_object('affected_members',count(*),'last_report_at',max(last_seen_at)) into v_uploads from public.space_client_issue_reports where category='upload' and reviewed_at is null;
 select jsonb_build_object('affected_members',count(*),'last_report_at',max(last_seen_at)) into v_notices from public.space_client_issue_reports where category='notifications' and reviewed_at is null;
 v_jobs:=jsonb_build_object('cron_available',to_regclass('cron.job') is not null,'approval_job',null,'push_job',null);
 if to_regclass('cron.job') is not null then
  begin
   execute 'select count(*)::integer from cron.job where active and jobname=''innovatex-approval-email-worker''' into v_active;
   v_jobs:=v_jobs||jsonb_build_object('approval_job',v_active>0);
   execute 'select count(*)::integer from cron.job where active and (jobname ilike ''%push%worker%'' or jobname ilike ''%push%deliver%'')' into v_active;
   v_jobs:=v_jobs||jsonb_build_object('push_job',v_active>0);
  exception when insufficient_privilege or undefined_column then null;
  end;
 end if;
 if to_regclass('storage.buckets') is not null then
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('name',x.name,'present',b.id is not null,'visibility_ok',case when b.id is null then null else coalesce(b.public,false)=(x.name='club-founder-portraits') end)),'[]') from unnest(array['club-media','club-documents','club-learning','club-course-evidence','club-finance-receipts','club-direct-files','club-shop-images','club-teacher-signatures','club-founder-portraits']) x(name) left join storage.buckets b on b.id=x.name$q$ into v_storage;
 end if;
 select not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='application_reason') and to_regclass('public.application_answers') is not null into v_security;
 return jsonb_build_object('checked_at',now(),'schema_checks',v_checks,'application_privacy_migration',v_security,'approval_emails',v_email,'push',v_push,'upload_reports',v_uploads,'notification_reports',v_notices,'schedules',v_jobs,'storage',v_storage);
end $$;
revoke all on function public.space_admin_system_health() from public,anon;
grant execute on function public.space_admin_system_health() to authenticated;

notify pgrst,'reload schema';
commit;
