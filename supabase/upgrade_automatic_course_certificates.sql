-- Run LAST, after upgrade_advanced_platform.sql and the course journey,
-- classroom access, founder teaching and learning dashboard migrations.
-- Teacher-confirmed learning AND practical completions issue one private
-- certificate. No passwords, service keys or email workers are required.
begin;

do $$ begin
  if to_regclass('public.space_certificates') is null
    or to_regclass('public.course_completions') is null then
    raise exception 'Run upgrade_advanced_platform.sql and the course journey migrations first';
  end if;
end $$;

alter table public.course_completions alter column submission_id drop not null;
alter table public.course_completions add column if not exists completion_kind text not null default 'practical'
  check (completion_kind in ('practical','learning'));
alter table public.course_completions add column if not exists confirmation_note text not null default '';
alter table public.space_certificates add column if not exists teacher_name text;
alter table public.space_certificates add column if not exists signed_by uuid references public.profiles(id);
alter table public.space_certificates add column if not exists signature_path text;
alter table public.space_certificates add column if not exists completed_at timestamptz;
alter table public.space_certificates add column if not exists completion_kind text;
alter table public.space_certificates add column if not exists teacher_confirmed_at timestamptz;
alter table public.space_certificates add column if not exists template_version text not null default 'turk-2026-v1';
create index if not exists space_certificates_learner_recent on public.space_certificates(learner_id,created_at desc,id);
create index if not exists space_certificates_signature on public.space_certificates(signature_path) where signature_path is not null;

create table if not exists public.space_certificate_signatories (
  user_id uuid primary key references public.profiles(id),
  teacher_name text not null check (length(btrim(teacher_name)) between 2 and 120),
  signature_path text not null,
  consent_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.space_certificate_signatories enable row level security;
revoke all on public.space_certificate_signatories from public,anon,authenticated;
grant select on public.space_certificate_signatories to authenticated;
drop policy if exists certificate_signer_read on public.space_certificate_signatories;
create policy certificate_signer_read on public.space_certificate_signatories for select to authenticated
  using (public.is_teacher() and (user_id=(select auth.uid()) or public.is_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('club-teacher-signatures','club-teacher-signatures',false,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.space_signature_referenced(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.space_certificates where signature_path=p_path)
   or exists(select 1 from public.space_certificate_signatories where signature_path=p_path)
$$;
create or replace function public.space_can_read_signature(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved() and (
   split_part(p_path,'/',1)=(select auth.uid()::text)
   or public.is_admin()
   or exists(select 1 from public.space_certificates c where c.signature_path=p_path
      and (c.learner_id=(select auth.uid()) or public.manages_classroom(c.course_id))))
$$;
revoke all on function public.space_signature_referenced(text),public.space_can_read_signature(text) from public,anon,authenticated;
grant execute on function public.space_signature_referenced(text),public.space_can_read_signature(text) to authenticated;

drop policy if exists certificate_signature_upload on storage.objects;
create policy certificate_signature_upload on storage.objects for insert to authenticated
  with check (bucket_id='club-teacher-signatures' and public.is_teacher()
    and split_part(name,'/',1)=(select auth.uid()::text)
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$');
drop policy if exists certificate_signature_read on storage.objects;
create policy certificate_signature_read on storage.objects for select to authenticated
  using (bucket_id='club-teacher-signatures' and public.space_can_read_signature(name));
drop policy if exists certificate_signature_cleanup on storage.objects;
-- No DELETE or UPDATE policy. Signature objects are immutable, including
-- across simultaneous issuance and profile edits. Orphans can be reviewed
-- by the project owner in Storage, rather than erased by a browser retry.

create or replace function public.space_save_certificate_signatory(p_name text,p_path text,p_consent boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles p where p.id=(select auth.uid())
    and p.membership_status='approved' and (p.role in ('admin','teacher')
      or (p.role='founder' and p.founder_teaching_enabled)) for share;
  if not found then raise exception 'Approved teacher access required'; end if;
  if p_consent is distinct from true then raise exception 'Acknowledge that this is your own signature'; end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Enter your full teacher name'; end if;
  if split_part(p_path,'/',1) is distinct from (select auth.uid()::text)
    or not exists(select 1 from storage.objects o where o.bucket_id='club-teacher-signatures'
      and o.name=p_path and o.metadata->>'mimetype' in ('image/png','image/jpeg','image/webp')) then
    raise exception 'Upload your own PNG, JPEG or WebP signature first';
  end if;
  insert into public.space_certificate_signatories(user_id,teacher_name,signature_path,consent_at)
    values((select auth.uid()),btrim(p_name),p_path,now())
    on conflict(user_id) do update set teacher_name=excluded.teacher_name,
      signature_path=excluded.signature_path,consent_at=now(),updated_at=now();
end $$;
revoke all on function public.space_save_certificate_signatory(text,text,boolean) from public,anon,authenticated;
grant execute on function public.space_save_certificate_signatory(text,text,boolean) to authenticated;

-- Private implementation. Completion-row locking makes issuance/retries
-- idempotent and prevents a changed name/signature rewriting an old award.
create or replace function public.space_make_completion_certificate(p_completion uuid,p_signer uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_completion public.course_completions%rowtype;
  v_signer public.space_certificate_signatories%rowtype;
  v_existing public.space_certificates%rowtype; v_id uuid; v_name text; v_title text;
begin
  if p_signer is distinct from (select auth.uid()) or not public.is_teacher() then
    raise exception 'Teacher confirmation required';
  end if;
  select * into v_completion from public.course_completions where id=p_completion for update;
  if not found or v_completion.learner_id=(select auth.uid())
    or not public.manages_classroom(v_completion.course_id) then
    raise exception 'Only the assigned teacher or administrator can confirm this completion';
  end if;
  select * into v_existing from public.space_certificates where completion_id=p_completion for update;
  if found and (v_existing.signed_by is not null or v_existing.revoked_at is not null) then return v_existing.id; end if;
  select p.full_name into v_name from public.profiles p join auth.users u on u.id=p.id
    where p.id=v_completion.learner_id and p.membership_status='approved'
      and p.role in ('member','teacher','founder','admin') and u.email_confirmed_at is not null for share of p;
  if not found then raise exception 'A verified, approved enrolled member is required'; end if;
  perform 1 from public.profiles p where p.id=p_signer and p.membership_status='approved'
    and (p.role in ('admin','teacher') or p.role='founder' and p.founder_teaching_enabled) for share;
  if not found then raise exception 'Approved teacher access required'; end if;
  select * into v_signer from public.space_certificate_signatories where user_id=p_signer for share;
  if not found or not exists(select 1 from storage.objects o where o.bucket_id='club-teacher-signatures'
    and o.name=v_signer.signature_path and o.metadata->>'mimetype' in ('image/png','image/jpeg','image/webp')) then
    raise exception 'Save your teacher name and signature in Teaching studio before confirming completion';
  end if;
  select title into v_title from public.courses where id=v_completion.course_id;
  if length(btrim(v_name)) not between 2 and 160 or length(btrim(v_title)) not between 2 and 240 then
    raise exception 'Before issuing a certificate, use a member name of 2 to 160 characters and a course title of 2 to 240 characters';
  end if;
  insert into public.space_certificates(completion_id,learner_id,course_id,recipient_name,course_title,
      teacher_name,signed_by,signature_path,completed_at,completion_kind,teacher_confirmed_at)
    values(p_completion,v_completion.learner_id,v_completion.course_id,v_name,v_title,
      v_signer.teacher_name,p_signer,v_signer.signature_path,v_completion.completed_at,v_completion.completion_kind,now())
    on conflict(completion_id) do update set teacher_name=excluded.teacher_name,signed_by=excluded.signed_by,
      signature_path=excluded.signature_path,completed_at=excluded.completed_at,
      completion_kind=excluded.completion_kind,teacher_confirmed_at=excluded.teacher_confirmed_at
    where space_certificates.signed_by is null and space_certificates.revoked_at is null
    returning id into v_id;
  if v_id is null then select id into v_id from public.space_certificates where completion_id=p_completion; return v_id; end if;
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values(v_completion.learner_id,'course_certificate','Your course certificate is ready: '||left(v_title,120),'certificate',v_id);
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(p_signer,'course_certificate_issued','certificate',v_id);
  return v_id;
end $$;
revoke all on function public.space_make_completion_certificate(uuid,uuid) from public,anon,authenticated;

create or replace function public.space_auto_certificate_after_completion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.assessed_by is distinct from (select auth.uid()) then raise exception 'Teacher acknowledgment is required'; end if;
  perform public.space_make_completion_certificate(new.id,new.assessed_by);
  return new;
end $$;
revoke all on function public.space_auto_certificate_after_completion() from public,anon,authenticated;
drop trigger if exists space_auto_certificate_after_completion on public.course_completions;
create trigger space_auto_certificate_after_completion after insert on public.course_completions
  for each row execute function public.space_auto_certificate_after_completion();

create or replace function public.space_confirm_course_completion(
  p_course uuid,p_learner uuid,p_kind text,p_note text,p_acknowledge boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_enrollment public.course_enrollments%rowtype; v_completion uuid; v_id uuid;
begin
  if p_acknowledge is distinct from true then raise exception 'Confirm that this member completed the course requirements'; end if;
  if not public.is_teacher() or p_learner=(select auth.uid()) then raise exception 'Teacher confirmation required; self-certification is not allowed'; end if;
  perform 1 from public.courses where id=p_course for share;
  if not found or not public.manages_classroom(p_course) then raise exception 'Only the assigned teacher or administrator may confirm this course'; end if;
  if p_kind is null or p_kind not in ('learning','practical') then raise exception 'Choose learning or practical completion'; end if;
  if length(btrim(coalesce(p_note,''))) not between 5 and 1000 then raise exception 'Record the completion evidence in 5 to 1000 characters'; end if;
  select * into v_enrollment from public.course_enrollments where course_id=p_course and learner_id=p_learner for update;
  if not found then raise exception 'This member is not enrolled in the course'; end if;
  select id into v_completion from public.course_completions where course_id=p_course and learner_id=p_learner;
  if v_completion is not null then return public.space_make_completion_certificate(v_completion,(select auth.uid())); end if;
  if v_enrollment.status<>'enrolled' then raise exception 'An active enrollment is required'; end if;
  if exists(select 1 from public.course_submissions where course_id=p_course and learner_id=p_learner and review_status='submitted') then
    raise exception 'Review the submitted final project first; accepting it automatically issues the certificate';
  end if;
  update public.course_enrollments set status='completed',completed_at=now() where id=v_enrollment.id;
  insert into public.course_completions(course_id,learner_id,assessed_by,completion_kind,confirmation_note)
    values(p_course,p_learner,(select auth.uid()),p_kind,btrim(p_note)) returning id into v_completion;
  select id into v_id from public.space_certificates where completion_id=v_completion;
  return v_id;
end $$;
revoke all on function public.space_confirm_course_completion(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.space_confirm_course_completion(uuid,uuid,text,text,boolean) to authenticated;

-- This existing API now only changes the holder's sharing preference. It
-- cannot mint an unsigned certificate, self-certify or un-revoke an award.
create or replace function public.space_issue_certificate(p_course uuid,p_public boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.is_approved() or p_public is null then raise exception 'Approved access required'; end if;
  update public.space_certificates set public_verification=p_public
    where course_id=p_course and learner_id=(select auth.uid()) returning id into v_id;
  if v_id is null then raise exception 'Your teacher must confirm completion and issue your certificate first'; end if;
  return v_id;
end $$;
revoke all on function public.space_issue_certificate(uuid,boolean) from public,anon,authenticated;
grant execute on function public.space_issue_certificate(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
