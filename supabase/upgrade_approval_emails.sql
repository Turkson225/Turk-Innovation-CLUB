-- Run after upgrade_roles_investors.sql in the Supabase SQL Editor.
-- Queue one welcome email when an account first becomes approved. The delivery
-- worker uses a service-role client; no mail credential or service key belongs
-- in this migration or in the browser.

create table if not exists public.approval_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  recipient_email text not null check (char_length(recipient_email) between 3 and 320),
  applicant_name text not null,
  application_type text not null check (application_type in ('member','teacher','founder','investor')),
  approved_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending','processing','retry','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists approval_email_due_idx
  on public.approval_email_outbox(next_attempt_at,created_at)
  where status in ('pending','retry');
create index if not exists approval_email_stale_idx
  on public.approval_email_outbox(locked_at)
  where status='processing';

alter table public.approval_email_outbox enable row level security;
revoke all on public.approval_email_outbox from public,anon,authenticated;
grant select on public.approval_email_outbox to service_role;
-- No client-facing policy: only the service-role worker and security-definer
-- trigger/function owner may read or change these email addresses and jobs.

-- Keep a separate registry so accounts already approved before this migration
-- do not receive an inaccurate first-time email after being suspended and
-- reapproved. A suspended account needs an approval audit event to prove it
-- was approved previously; suspension alone does not prove that.
create table if not exists public.approval_email_history (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  source text not null check (source in ('preexisting','email_queued')),
  tracked_at timestamptz not null default now()
);
alter table public.approval_email_history enable row level security;
revoke all on public.approval_email_history from public,anon,authenticated;
insert into public.approval_email_history(user_id,source)
select p.id,'preexisting'
  from public.profiles p
 where p.membership_status='approved'
    or exists (
      select 1 from public.audit_events a
       where a.target_type='profile' and a.target_id=p.id
         and a.action ~ '^membership_approved($|_)'
    )
on conflict (user_id) do nothing;
-- Earlier versions marked every suspended account as a prior approval. On a
-- rerun, remove that assumption where no approval audit or queued email can
-- confirm it; otherwise a first-time suspended applicant could skip the form.
delete from public.approval_email_history h using public.profiles p
 where p.id=h.user_id and h.source='preexisting'
   and p.membership_status<>'approved'
   and not exists (
     select 1 from public.audit_events a
      where a.target_type='profile' and a.target_id=p.id
        and a.action ~ '^membership_approved($|_)'
   )
   and not exists (select 1 from public.approval_email_outbox q where q.user_id=p.id);

create or replace function public.queue_approval_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if new.membership_status = 'approved'
     and old.membership_status is distinct from 'approved'
     and new.role in ('member','teacher','founder','investor')
     and not exists(select 1 from public.approval_email_history h where h.user_id=new.id) then
    select lower(trim(u.email)) into v_email from auth.users u where u.id=new.id;
    if v_email is null or v_email='' then
      raise exception 'An email address is required before approving membership';
    end if;
    insert into public.approval_email_outbox
      (user_id,recipient_email,applicant_name,application_type,approved_at)
    values
      (new.id,v_email,coalesce(nullif(trim(new.full_name),''),'Club member'),
       new.role,now())
    on conflict (user_id) do nothing;
    insert into public.approval_email_history(user_id,source)
      values(new.id,'email_queued') on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_approval_email() from public,anon,authenticated;
drop trigger if exists queue_approval_email_on_approval on public.profiles;
create trigger queue_approval_email_on_approval
after update of membership_status on public.profiles
for each row execute function public.queue_approval_email();

-- Protect the status transition itself, including manual administrator SQL and
-- future approval paths that do not call review_membership(). An old approved
-- account being restored may have no historical application reason, but still
-- needs a confirmed email.
create or replace function public.require_complete_application_for_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_status = 'approved'
     and old.membership_status is distinct from 'approved'
     and new.role in ('member','teacher','founder','investor') then
    if not exists (select 1 from auth.users u
                    where u.id = new.id and u.email_confirmed_at is not null) then
      raise exception 'Applicant must verify their email before approval';
    end if;
    if nullif(trim(new.application_reason),'') is null
       and not exists (select 1 from public.approval_email_history h
                        where h.user_id = new.id) then
      raise exception 'Applicant must submit a reason for joining before approval';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.require_complete_application_for_approval()
  from public,anon,authenticated;
drop trigger if exists require_complete_application_before_approval on public.profiles;
create trigger require_complete_application_before_approval
before update of membership_status on public.profiles
for each row execute function public.require_complete_application_for_approval();

-- The application review page can report verification without exposing
-- auth.users or email addresses to browser clients. Limit each call to the
-- current page of applicants.
create or replace function public.application_verification_status(p_users uuid[])
returns table(user_id uuid,email_verified boolean,previously_approved boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if cardinality(coalesce(p_users,array[]::uuid[]))>50 then
    raise exception 'Review up to 50 applicants at a time';
  end if;
  return query
    select p.id,u.email_confirmed_at is not null,
           exists(select 1 from public.approval_email_history h where h.user_id=p.id)
      from public.profiles p
      join auth.users u on u.id=p.id
     where p.id=any(coalesce(p_users,array[]::uuid[]));
end $$;
revoke all on function public.application_verification_status(uuid[]) from public,anon;
grant execute on function public.application_verification_status(uuid[]) to authenticated;

-- Approval can only complete after email verification and an application has
-- been submitted. Restoring an existing suspended member is still possible
-- when a historical application reason was not captured.
create or replace function public.review_membership(p_user uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_type text;v_status text;v_reason text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('approved','rejected','suspended') then
    raise exception 'Invalid review decision';
  end if;
  if p_user=auth.uid() then raise exception 'You cannot review your own account'; end if;

  select p.application_type,p.membership_status,p.application_reason
    into v_type,v_status,v_reason
    from public.profiles p where p.id=p_user and p.role<>'admin' for update;
  if not found then raise exception 'Applicant not found or cannot be changed'; end if;

  if p_status='approved' then
    if not exists(select 1 from auth.users u
                   where u.id=p_user and u.email_confirmed_at is not null) then
      raise exception 'Applicant must verify their email before approval';
    end if;
    if v_status in ('pending','rejected')
       and nullif(trim(v_reason),'') is null
       and not exists(select 1 from public.approval_email_history h where h.user_id=p_user) then
      raise exception 'Applicant must submit a reason for joining before approval';
    end if;
    update public.profiles set membership_status='approved',role=v_type where id=p_user;
  else
    update public.profiles set membership_status=p_status where id=p_user;
  end if;

  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'membership_'||p_status||'_'||v_type,'profile',p_user);
  if p_status='approved' then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(p_user,'membership','Your InnovateX application was approved','application',p_user);
  end if;
end $$;
revoke all on function public.review_membership(uuid,text) from public,anon;
grant execute on function public.review_membership(uuid,text) to authenticated;

-- Safely claim due jobs without allowing two workers to send the same claim.
-- A crashed worker's claim expires after ten minutes. The provider may still
-- have accepted a message before a crash, so delivery is at least once.
create or replace function public.claim_approval_email_jobs(p_limit integer default 10)
returns setof public.approval_email_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.approval_email_outbox j
     set status='failed',locked_at=null,claim_token=null,
         last_error=coalesce(j.last_error,'Delivery worker timed out after eight attempts')
   where j.status='processing' and j.attempts>=8
     and j.locked_at < now()-interval '10 minutes';

  return query
  with due as (
    select j.id
      from public.approval_email_outbox j
      join public.profiles p on p.id=j.user_id
     where p.membership_status='approved' and j.attempts<8
       and ((j.status in ('pending','retry') and j.next_attempt_at<=now())
         or (j.status='processing' and j.locked_at<now()-interval '10 minutes'))
     order by j.created_at,j.id
     limit least(greatest(coalesce(p_limit,10),1),50)
     for update of j skip locked
  )
  update public.approval_email_outbox j
     set status='processing',attempts=j.attempts+1,
         claim_token=gen_random_uuid(),locked_at=now(),last_error=null
    from due
   where j.id=due.id
  returning j.*;
end $$;
revoke all on function public.claim_approval_email_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_approval_email_jobs(integer) to service_role;

-- Finish only the current claim. Delayed workers cannot overwrite the result
-- of a newer claim. Failed attempts back off from 2 to 128 minutes.
create or replace function public.finish_approval_email_job(
  p_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_success is null then
    raise exception 'Delivery result is required';
  end if;

  update public.approval_email_outbox j
     set status=case when p_success then 'sent'
                     when j.attempts>=8 then 'failed' else 'retry' end,
         sent_at=case when p_success then now() else null end,
         next_attempt_at=case when p_success or j.attempts>=8 then j.next_attempt_at
                              else now()+make_interval(mins=>power(2,j.attempts)::integer) end,
         provider_message_id=case when p_success then left(p_provider_message_id,256) else null end,
         last_error=case when p_success then null
                         else left(coalesce(nullif(p_error,''),'Email delivery failed'),500) end,
         claim_token=null,locked_at=null
   where j.id=p_id and j.claim_token=p_claim_token and j.status='processing';
  if not found then
    raise exception 'Email job is not currently claimed with this token';
  end if;
end $$;
revoke all on function public.finish_approval_email_job(uuid,uuid,boolean,text,text)
  from public,anon,authenticated;
grant execute on function public.finish_approval_email_job(uuid,uuid,boolean,text,text)
  to service_role;

-- To manually retry a failed job after fixing its delivery problem, a project
-- owner can use SQL Editor to set status='retry', attempts=0 and
-- next_attempt_at=now() for that job. This is intentionally not a web RPC.
