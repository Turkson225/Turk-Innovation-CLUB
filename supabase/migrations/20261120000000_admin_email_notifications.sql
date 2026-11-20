-- SPACE administrator email alerts. Apply after the security migration.
-- No live email is enabled by this migration. The worker and Cron are separate.
begin;

do $$ begin
  if to_regprocedure('public.space_require_recent_admin_mfa()') is null then
    raise exception 'Apply the SPACE security hardening migration before administrator email alerts.';
  end if;
end $$;

create table if not exists space_private.admin_mail_settings (
  singleton boolean primary key default true check(singleton),
  recipient text,
  enabled boolean not null default false,
  categories text[] not null default array['updates','alerts','errors','security','service_status'],
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check(not enabled or (recipient is not null and cardinality(categories)>0))
);
insert into space_private.admin_mail_settings(singleton) values(true) on conflict do nothing;

create table if not exists space_private.admin_mail_jobs (
  id uuid primary key default gen_random_uuid(),
  revision bigint not null,
  code text not null,
  bucket timestamptz not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  occurrences integer not null default 1 check(occurrences>0),
  observed_count bigint check(observed_count is null or observed_count>=0),
  state text not null default 'queued' check(state in ('queued','claimed','sending','retry','sent','failed','uncertain','cancelled')),
  attempts integer not null default 0 check(attempts between 0 and 4),
  next_at timestamptz not null default now(),
  claim_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  last_code text,
  updated_at timestamptz not null default now(),
  unique(revision,code,bucket)
);
create index if not exists admin_mail_due_idx on space_private.admin_mail_jobs(next_at,first_at,id) where state in ('queued','retry');
create index if not exists admin_mail_lease_idx on space_private.admin_mail_jobs(lease_until) where state in ('claimed','sending');
create index if not exists admin_mail_audit_idx on space_private.admin_mail_jobs(first_at desc,id desc);
create table if not exists space_private.admin_mail_attempts (
  job_id uuid not null references space_private.admin_mail_jobs(id) on delete cascade,
  attempt integer not null,
  claimed_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  outcome text,
  code text,
  primary key(job_id,attempt)
);
create index if not exists admin_mail_attempts_hour_idx on space_private.admin_mail_attempts(claimed_at);

create table if not exists space_private.admin_mail_monitor (
  signal text primary key,
  revision bigint not null,
  confirmed boolean not null default false,
  previous_sample boolean not null,
  sampled_at timestamptz not null
);
create table if not exists space_private.admin_mail_worker (
  singleton boolean primary key default true check(singleton),
  last_poll_at timestamptz not null,
  sender_ready boolean not null
);
alter table space_private.admin_mail_settings enable row level security;
alter table space_private.admin_mail_jobs enable row level security;
alter table space_private.admin_mail_attempts enable row level security;
alter table space_private.admin_mail_monitor enable row level security;
alter table space_private.admin_mail_worker enable row level security;
revoke all on space_private.admin_mail_settings,space_private.admin_mail_jobs,space_private.admin_mail_attempts,
  space_private.admin_mail_monitor,space_private.admin_mail_worker from public,anon,authenticated,service_role;

-- Only this catalogue can enter the email. No source titles, report content,
-- people, IPs, addresses, raw provider responses or user-generated URLs.
create or replace function space_private.admin_mail_catalog()
returns table(code text,category text,severity text,title text,resource text,summary text,recommendation text,route text)
language sql immutable set search_path='' as $$
  values
  ('announcement','updates','info','Club announcement published','Announcements','A new club announcement was published.','Open Announcements to review the update.','announcements'),
  ('chapter_change','updates','info','Chapter changed','Chapter control centre','A chapter was created or its operating status changed.','Review the current chapter status and leadership assignment.','chapter-admin'),
  ('urgent_announcement','alerts','high','Urgent club announcement','Announcements','An announcement marked urgent was published.','Review the notice and confirm that the affected members have the information they need.','announcements'),
  ('moderation_report','alerts','warning','New moderation reports','Moderation queue','One or more reports were filed for administrator review.','Open Moderation and review the reports in the private workspace.','moderation'),
  ('account_suspended','security','high','Account suspension recorded','Membership access','An account was suspended through the administrator review workflow.','Review recent administrative actions and confirm that the change was expected.','admin'),
  ('access_changed','security','warning','Role or office access changed','Account and office permissions','A club account role, teaching permission, or office appointment was changed.','Review the authorized role assignments. Investigate unexpected changes.','admin'),
  ('upload_errors','errors','warning','Multiple members reporting upload errors','File uploads','At least three distinct accounts recently reported upload problems.','Review the upload reports and storage configuration in System health.','system-health'),
  ('device_errors','errors','warning','Multiple members reporting notification errors','Device notifications','At least three distinct accounts recently reported device notification problems.','Review client reports and test delivery with a consenting registered device.','system-health'),
  ('approval_degraded','service_status','high','Approval email delivery needs attention','Approval emails','The approval email queue has overdue work or recent failed jobs.','Check the approval worker schedule, logs and SMTP configuration.','system-health'),
  ('approval_recovered','service_status','info','Approval email queue alert cleared','Approval emails','The monitored approval email queue no longer shows the condition that triggered the earlier alert.','Check queue health and verify any remaining delivery issues.','system-health'),
  ('push_degraded','service_status','warning','Push delivery needs attention','Push notifications','The push queue has overdue work or recent failed jobs.','Check the push worker schedule and logs.','system-health'),
  ('push_recovered','service_status','info','Push queue alert cleared','Push notifications','The monitored push queue no longer shows the condition that triggered the earlier alert.','Verify delivery on a registered device if needed.','system-health'),
  ('test','test','info','Test administrator email','Administrator email settings','SPACE queued this test from the administrator settings.','Confirm this inbox and check the delivery log in System health.','system-health');
$$;

create or replace function space_private.admin_mail_enqueue(p_code text,p_count bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; c record; v_id uuid; v_now timestamptz:=clock_timestamp();
begin
  select * into c from space_private.admin_mail_catalog() x where x.code=p_code;
  if not found then raise exception 'Unsupported administrator email event'; end if;
  select * into s from space_private.admin_mail_settings where singleton for share;
  if not s.enabled or (c.category<>'test' and not(c.category=any(s.categories))) then return null; end if;
  insert into space_private.admin_mail_jobs(revision,code,bucket,first_at,last_at,observed_count,next_at)
  values(s.revision,p_code,date_bin(interval '15 minutes',v_now,timestamptz '2000-01-01 UTC'),v_now,v_now,p_count,
    v_now+case when p_code='test' then interval '0' else interval '60 seconds' end)
  on conflict(revision,code,bucket) do update
    set occurrences=least(2147483646,admin_mail_jobs.occurrences)+1,last_at=excluded.last_at,
      observed_count=greatest(admin_mail_jobs.observed_count,excluded.observed_count)
    where p_code<>'test'
  returning id into v_id;
  return v_id;
end $$;

create or replace function space_private.admin_mail_capture()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text;
begin
  if tg_table_name='announcements' then
    v_code:=case when new.priority='urgent' then 'urgent_announcement' else 'announcement' end;
  elsif tg_table_name='reports' then
    v_code:='moderation_report';
  elsif tg_table_name='space_chapters' then
    if tg_op='INSERT' then v_code:='chapter_change';
    elsif new.status is distinct from old.status then v_code:='chapter_change'; end if;
  elsif tg_table_name='audit_events' then
    if new.action ~ '^membership_suspended(_(member|teacher|founder|investor))?$' then
      v_code:='account_suspended';
    elsif new.action ~ '^(account_role_|founder_role_removed_to_|chapter_role_)'
      or new.action in ('officer_roles_changed','founder_accepted','founder_teaching_enabled','founder_teaching_disabled',
        'teacher_promoted_to_founder','chapter_office_assigned','chapter_office_revoked') then
      v_code:='access_changed';
    end if;
  end if;
  if v_code is not null then
    begin
      perform space_private.admin_mail_enqueue(v_code);
    exception when others then
      -- A notification fault does not undo the original club action.
      raise warning 'SPACE administrator mail capture failed (SQLSTATE %)', sqlstate;
    end;
  end if;
  return new;
end $$;

drop trigger if exists space_admin_mail_announcement on public.announcements;
create trigger space_admin_mail_announcement after insert on public.announcements
  for each row execute function space_private.admin_mail_capture();
drop trigger if exists space_admin_mail_report on public.reports;
create trigger space_admin_mail_report after insert on public.reports
  for each row execute function space_private.admin_mail_capture();
drop trigger if exists space_admin_mail_audit on public.audit_events;
create trigger space_admin_mail_audit after insert on public.audit_events
  for each row execute function space_private.admin_mail_capture();
do $$ begin
  if to_regclass('public.space_chapters') is not null then
    execute 'drop trigger if exists space_admin_mail_chapter on public.space_chapters';
    execute 'create trigger space_admin_mail_chapter after insert or update of status on public.space_chapters for each row execute function space_private.admin_mail_capture()';
  end if;
end $$;

create or replace function public.space_admin_mail_read(p_before timestamptz default null,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; v_rows jsonb; v_worker jsonb; v_queue jsonb;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='Verified administrator access required'; end if;
  if (p_before is null)<>(p_id is null) then raise exception 'Invalid audit cursor'; end if;
  select * into s from space_private.admin_mail_settings where singleton;
  select jsonb_build_object('last_poll_at',last_poll_at,'sender_ready',sender_ready)
    into v_worker from space_private.admin_mail_worker where singleton;
  select jsonb_build_object('waiting',count(*) filter(where state in ('queued','retry','claimed','sending')),
    'attention',count(*) filter(where state in ('failed','uncertain') and first_at>=now()-interval '7 days'))
    into v_queue from space_private.admin_mail_jobs;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.first_at desc,r.id desc),'[]') into v_rows from(
    select j.id,j.first_at,j.last_at,j.sent_at,j.updated_at,j.occurrences,j.observed_count,j.state,j.attempts,j.last_code,
      c.category,c.severity,c.title,c.resource,
      coalesce((select jsonb_agg(jsonb_build_object('attempt',a.attempt,'claimed_at',a.claimed_at,
        'started_at',a.started_at,'finished_at',a.finished_at,'outcome',a.outcome,'code',a.code) order by a.attempt)
        from space_private.admin_mail_attempts a where a.job_id=j.id),'[]') as history
    from space_private.admin_mail_jobs j join space_private.admin_mail_catalog() c on c.code=j.code
    where p_before is null or (j.first_at,j.id)<(p_before,p_id)
    order by j.first_at desc,j.id desc limit 26
  ) r;
  return jsonb_build_object('settings',jsonb_build_object('recipient',s.recipient,'enabled',s.enabled,
    'categories',s.categories,'revision',s.revision,'updated_at',s.updated_at),'jobs',v_rows,'worker',v_worker,'queue',v_queue);
end $$;

create or replace function public.space_admin_mail_save(p_recipient text,p_enabled boolean,p_categories text[],p_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; v_email text:=nullif(btrim(p_recipient),''); v_categories text[];
begin
  if not public.is_admin() then raise exception using errcode='42501',message='Verified administrator access required'; end if;
  perform public.space_require_recent_admin_mfa();
  if p_enabled is null or p_categories is null or cardinality(p_categories)>5
    or exists(select 1 from unnest(p_categories) x where x is null or x not in ('updates','alerts','errors','security','service_status')) then
    raise exception 'Choose valid email preferences';
  end if;
  select coalesce(array_agg(distinct x order by x),'{}') into v_categories from unnest(p_categories) x;
  if v_email is not null and (length(v_email)>254 or length(split_part(v_email,'@',1))>64 or
    v_email !~* '^[a-z0-9%_+~-]+([.][a-z0-9%_+~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$') then
    raise exception 'Enter one valid recipient email address';
  end if;
  if p_enabled and (v_email is null or cardinality(v_categories)=0) then raise exception 'Set an address and enable at least one category'; end if;
  select * into s from space_private.admin_mail_settings where singleton for update;
  if s.revision is distinct from p_revision then
    raise exception using errcode='40001',message='Email settings were changed. Refresh and review your edits.';
  end if;
  if s.enabled=p_enabled and s.recipient is not distinct from v_email and
    (select array_agg(x order by x) from unnest(s.categories) x) is not distinct from
    (select array_agg(x order by x) from unnest(v_categories) x) then return; end if;

  -- Change of recipient, pause or preference never redirects previous alerts.
  -- A dispatch already handed to SMTP may finish; never invalidate its audit.
  with stopped as (
    update space_private.admin_mail_jobs set state='cancelled',last_code='settings_changed',
      claim_token=null,lease_until=null,updated_at=now()
    where state in ('queued','retry','claimed') returning id,attempts
  ) update space_private.admin_mail_attempts a set finished_at=now(),outcome='cancelled',code='settings_changed'
    from stopped s2 where a.job_id=s2.id and a.attempt=s2.attempts and a.finished_at is null;
  update space_private.admin_mail_settings set recipient=v_email,enabled=p_enabled,categories=v_categories,
    revision=revision+1,updated_at=now(),updated_by=auth.uid() where singleton;
  insert into public.audit_events(actor_id,action,target_type) values(auth.uid(),'admin_mail_settings_updated','platform_settings');
end $$;

create or replace function public.space_admin_mail_test()
returns uuid language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; v_id uuid;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='Verified administrator access required'; end if;
  perform public.space_require_recent_admin_mfa();
  select * into s from space_private.admin_mail_settings where singleton for update;
  if not s.enabled then raise exception 'Enable administrator emails before requesting a test'; end if;
  if exists(select 1 from space_private.admin_mail_jobs where code='test' and first_at>now()-interval '15 minutes') then
    raise exception using errcode='P0001',message='A test email was requested recently. Check the log or wait 15 minutes.';
  end if;
  v_id:=space_private.admin_mail_enqueue('test');
  return v_id;
end $$;

-- The worker samples observable delivery conditions, not the health of the
-- entire site. Two observations at least a minute apart confirm a transition.
create or replace function space_private.admin_mail_observe(
  p_signal text,p_bad boolean,p_bad_code text,p_good_code text,p_count bigint,p_revision bigint
) returns void language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_monitor%rowtype; v_now timestamptz:=clock_timestamp();
begin
  select * into s from space_private.admin_mail_monitor where signal=p_signal for update;
  if not found or s.revision<>p_revision then
    insert into space_private.admin_mail_monitor values(p_signal,p_revision,false,p_bad,v_now)
    on conflict(signal) do update set revision=excluded.revision,confirmed=false,
      previous_sample=excluded.previous_sample,sampled_at=excluded.sampled_at;
    return;
  end if;
  if s.sampled_at>v_now-interval '1 minute' then return; end if;
  if p_bad=s.previous_sample and p_bad<>s.confirmed then
    if p_bad then perform space_private.admin_mail_enqueue(p_bad_code,p_count);
    elsif p_good_code is not null then perform space_private.admin_mail_enqueue(p_good_code,0); end if;
    s.confirmed:=p_bad;
  end if;
  update space_private.admin_mail_monitor set confirmed=s.confirmed,previous_sample=p_bad,sampled_at=v_now
    where signal=p_signal;
end $$;

create or replace function public.space_admin_mail_poll(p_sender_ready boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; v_count bigint;
begin
  select * into s from space_private.admin_mail_settings where singleton for update;
  insert into space_private.admin_mail_worker values(true,now(),coalesce(p_sender_ready,false))
    on conflict(singleton) do update set last_poll_at=excluded.last_poll_at,sender_ready=excluded.sender_ready;
  with expired as (
    update space_private.admin_mail_jobs set
      state=case when state='sending' then 'uncertain' when attempts>=4 then 'failed' else 'retry' end,
      last_code=case when state='sending' then 'confirmation_missing' else 'lease_expired' end,
      lease_until=null,claim_token=null,updated_at=now(),next_at=now()+interval '5 minutes'
    where state in ('claimed','sending') and lease_until<now()
    returning id,attempts,state,last_code
  ) update space_private.admin_mail_attempts a set finished_at=now(),outcome=e.state,code=e.last_code
    from expired e where a.job_id=e.id and a.attempt=e.attempts;
  update space_private.admin_mail_jobs set state='cancelled',updated_at=now(),last_code='event_expired'
    where state in ('queued','retry') and first_at<now()-interval '24 hours';
  delete from space_private.admin_mail_jobs where first_at<now()-interval '90 days'
    and state not in ('claimed','sending');
  if not s.enabled then return; end if;

  if 'service_status'=any(s.categories) and to_regclass('public.approval_email_outbox') is not null then
    execute $q$select count(*) from public.approval_email_outbox where
      (status in ('pending','retry') and next_attempt_at<now()-interval '10 minutes')
      or (status='processing' and locked_at<now()-interval '10 minutes')
      or (status='failed' and created_at>now()-interval '1 hour')$q$ into v_count;
    perform space_private.admin_mail_observe('approval',v_count>0,'approval_degraded','approval_recovered',v_count,s.revision);
  end if;
  if 'service_status'=any(s.categories) and to_regclass('public.push_outbox') is not null then
    execute $q$select count(*) from public.push_outbox where
      (status in ('pending','retry') and next_attempt_at<now()-interval '10 minutes')
      or (status='processing' and locked_at<now()-interval '10 minutes')
      or (status='failed' and created_at>now()-interval '1 hour')$q$ into v_count;
    perform space_private.admin_mail_observe('push',v_count>0,'push_degraded','push_recovered',v_count,s.revision);
  end if;
  if 'errors'=any(s.categories) and to_regclass('public.space_client_issue_reports') is not null then
    execute $q$select count(*) from public.space_client_issue_reports
      where category='upload' and reviewed_at is null and last_seen_at>=now()-interval '30 minutes'$q$ into v_count;
    perform space_private.admin_mail_observe('upload',v_count>=3,'upload_errors',null,v_count,s.revision);
    execute $q$select count(*) from public.space_client_issue_reports
      where category='notifications' and reviewed_at is null and last_seen_at>=now()-interval '30 minutes'$q$ into v_count;
    perform space_private.admin_mail_observe('device',v_count>=3,'device_errors',null,v_count,s.revision);
  end if;
end $$;

create or replace function public.space_admin_mail_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; j space_private.admin_mail_jobs%rowtype;
begin
  -- Serialize reservation of an hourly sending slot with configuration writes.
  select * into s from space_private.admin_mail_settings where singleton for update;
  if not s.enabled or (select count(*) from space_private.admin_mail_attempts where claimed_at>now()-interval '1 hour')>=12
    then return null; end if;
  select x.* into j from space_private.admin_mail_jobs x
  join space_private.admin_mail_catalog() c on c.code=x.code
  where x.state in ('queued','retry') and x.revision=s.revision and x.next_at<=now()
    and x.first_at>=now()-interval '24 hours' and (c.category='test' or c.category=any(s.categories)) and x.attempts<4
  order by case c.severity when 'high' then 0 when 'warning' then 1 else 2 end,x.next_at,x.id
  limit 1 for update of x skip locked;
  if not found then return null; end if;
  update space_private.admin_mail_jobs set state='claimed',attempts=attempts+1,claim_token=gen_random_uuid(),
    lease_until=now()+interval '3 minutes',updated_at=now() where id=j.id returning * into j;
  insert into space_private.admin_mail_attempts(job_id,attempt) values(j.id,j.attempts);
  return jsonb_build_object('id',j.id,'token',j.claim_token);
end $$;

-- The destination only becomes visible after a fresh preference/lease check.
create or replace function public.space_admin_mail_start(p_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; j space_private.admin_mail_jobs%rowtype; c record;
begin
  select * into s from space_private.admin_mail_settings where singleton for update;
  select * into j from space_private.admin_mail_jobs where id=p_id and claim_token=p_token and state='claimed'
    and lease_until>=now() and revision=s.revision for update;
  if not found or not s.enabled then return null; end if;
  select * into c from space_private.admin_mail_catalog() x where x.code=j.code;
  if not found or (c.category<>'test' and not(c.category=any(s.categories))) then return null; end if;
  update space_private.admin_mail_jobs set state='sending',lease_until=now()+interval '3 minutes',updated_at=now()
    where id=j.id;
  update space_private.admin_mail_attempts set started_at=now() where job_id=j.id and attempt=j.attempts;
  return to_jsonb(c)||jsonb_build_object('id',j.id,'recipient',s.recipient,'first_at',j.first_at,'last_at',j.last_at,
    'occurrences',j.occurrences,'observed_count',j.observed_count);
end $$;

create or replace function public.space_admin_mail_finish(p_id uuid,p_token uuid,p_outcome text,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare s space_private.admin_mail_settings%rowtype; j space_private.admin_mail_jobs%rowtype; v_state text; v_code text;
begin
  if p_outcome is null or p_outcome not in ('sent','retry','failed','uncertain') then raise exception 'Invalid delivery outcome'; end if;
  if not (
    (p_outcome='sent' and p_code is null)
    or (p_outcome='retry' and coalesce(p_code,'') in ('smtp_temporary','transport_before_message'))
    or (p_outcome='failed' and coalesce(p_code,'') in ('smtp_rejected','sender_rejected','invalid_message'))
    or (p_outcome='uncertain' and coalesce(p_code,'') in ('smtp_timeout','confirmation_missing'))
  ) then raise exception 'Invalid delivery result code'; end if;
  select * into s from space_private.admin_mail_settings where singleton for update;
  select * into j from space_private.admin_mail_jobs where id=p_id and claim_token=p_token and state='sending' for update;
  if not found then return false; end if;
  v_state:=p_outcome;v_code:=p_code;
  if p_outcome='retry' and (not s.enabled or s.revision<>j.revision) then v_state:='cancelled';v_code:='settings_changed';
  elsif p_outcome='retry' and j.attempts>=4 then v_state:='failed'; end if;
  update space_private.admin_mail_jobs set state=v_state,last_code=v_code,updated_at=now(),
    sent_at=case when v_state='sent' then now() else null end,lease_until=null,claim_token=null,
    next_at=now()+case j.attempts when 1 then interval '5 minutes' when 2 then interval '20 minutes' else interval '60 minutes' end
    where id=j.id;
  update space_private.admin_mail_attempts set finished_at=now(),outcome=v_state,code=v_code
    where job_id=j.id and attempt=j.attempts;
  return true;
end $$;

revoke all on function space_private.admin_mail_catalog(),space_private.admin_mail_enqueue(text,bigint),
  space_private.admin_mail_capture(),space_private.admin_mail_observe(text,boolean,text,text,bigint,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.space_admin_mail_read(timestamptz,uuid),public.space_admin_mail_save(text,boolean,text[],bigint),
  public.space_admin_mail_test(),public.space_admin_mail_poll(boolean),public.space_admin_mail_claim(),
  public.space_admin_mail_start(uuid,uuid),public.space_admin_mail_finish(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.space_admin_mail_read(timestamptz,uuid),public.space_admin_mail_save(text,boolean,text[],bigint),
  public.space_admin_mail_test() to authenticated;
grant execute on function public.space_admin_mail_poll(boolean),public.space_admin_mail_claim(),
  public.space_admin_mail_start(uuid,uuid),public.space_admin_mail_finish(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
