-- Run after upgrade_membership_collaboration.sql and upgrade_direct_messages.sql.
-- Web Push is opt-in per browser/device. Existing notifications are not replayed.
-- The browser can manage only its signed-in owner's subscription. The worker
-- alone can claim deliveries; no VAPID secret or push endpoint is public.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique
    check (char_length(endpoint) between 30 and 2048)
    check (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/[^[:space:]]+$'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,120}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_owner_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select,delete on public.push_subscriptions to authenticated;
grant insert(user_id,endpoint,p256dh,auth) on public.push_subscriptions to authenticated;
grant update(user_id,endpoint,p256dh,auth) on public.push_subscriptions to authenticated;

create policy "Members see own push devices" on public.push_subscriptions
  for select to authenticated
  using (user_id=(select auth.uid()) and public.is_approved());
create policy "Members register own push devices" on public.push_subscriptions
  for insert to authenticated
  with check (user_id=(select auth.uid()) and public.is_approved());
create policy "Members refresh own push devices" on public.push_subscriptions
  for update to authenticated
  using (user_id=(select auth.uid()) and public.is_approved())
  with check (user_id=(select auth.uid()) and public.is_approved());
create policy "Members remove own push devices" on public.push_subscriptions
  for delete to authenticated
  using (user_id=(select auth.uid()));

create or replace function public.stamp_push_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op='INSERT' then
    if (select count(*) from public.push_subscriptions where user_id=new.user_id) >= 8
       and not exists(select 1 from public.push_subscriptions
                       where user_id=new.user_id and endpoint=new.endpoint) then
      raise exception 'At most eight push devices can be registered';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.stamp_push_subscription() from public,anon,authenticated;
drop trigger if exists stamp_push_subscription on public.push_subscriptions;
create trigger stamp_push_subscription before insert or update on public.push_subscriptions
  for each row execute function public.stamp_push_subscription();

create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','processing','retry','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  claim_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(notification_id,subscription_id)
);
create index if not exists push_outbox_due_idx on public.push_outbox(next_attempt_at,created_at)
  where status in ('pending','retry');
create index if not exists push_outbox_processing_idx on public.push_outbox(locked_at)
  where status='processing';
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public,anon,authenticated;
-- Security-definer functions and the named-key Edge worker alone access jobs.

create or replace function public.queue_web_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_outbox(notification_id,subscription_id)
    select new.id,s.id
      from public.push_subscriptions s
      join public.profiles p on p.id=s.user_id
     where s.user_id=new.user_id
       and p.membership_status='approved'
       and p.role in ('member','teacher','founder','admin')
       and (new.kind<>'application' or p.role='admin');
  return new;
end $$;
revoke all on function public.queue_web_push() from public,anon,authenticated;
drop trigger if exists queue_web_push on public.notifications;
create trigger queue_web_push after insert on public.notifications
  for each row execute function public.queue_web_push();

-- A new official announcement appears in each approved club account's inbox.
-- It also enters the push outbox for members who opted in on a device. Old
-- announcements are deliberately not replayed when this migration is run.
create or replace function public.notify_club_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    select p.id,'announcement',
           case when new.priority='urgent' then 'Urgent club announcement: '
                else 'New club announcement: ' end ||
             left(regexp_replace(trim(new.title),'[[:space:]]+',' ','g'),100),
           'announcement',new.id
      from public.profiles p
     where p.membership_status='approved'
       and p.role in ('member','teacher','founder','admin');
  return new;
end $$;
revoke all on function public.notify_club_announcement() from public,anon,authenticated;
drop trigger if exists notify_club_announcement on public.announcements;
create trigger notify_club_announcement after insert on public.announcements
  for each row execute function public.notify_club_announcement();

-- Polymorphic notification targets have no foreign key to announcements.
-- Remove their inbox rows when an administrator removes the announcement;
-- push jobs disappear automatically through their notification foreign key.
create index if not exists notifications_announcement_target_idx
  on public.notifications(target_id)
  where kind='announcement' and target_type='announcement';
create or replace function public.remove_club_announcement_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
   where kind='announcement' and target_type='announcement' and target_id=old.id;
  return old;
end $$;
revoke all on function public.remove_club_announcement_notifications() from public,anon,authenticated;
drop trigger if exists remove_club_announcement_notifications on public.announcements;
create trigger remove_club_announcement_notifications after delete on public.announcements
  for each row execute function public.remove_club_announcement_notifications();

-- Open tabs receive the same owner-scoped alert immediately over Realtime.
-- The outbox and subscriptions never enter the Realtime publication.
do $$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'Supabase Realtime publication is unavailable';
  end if;
  if not exists(select 1 from pg_publication_tables
                where pubname='supabase_realtime'
                  and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Claims are atomic across simultaneous worker calls. Old or ineligible jobs
-- are discarded before claiming so a returned member cannot receive a stale
-- message queued before their suspension. A sent-but-unacknowledged job may
-- be delivered again after a worker crash; clients coalesce by notification ID.
create or replace function public.claim_push_jobs(p_limit integer default 10)
returns table(id uuid,notification_id uuid,subscription_id uuid,user_id uuid,
  endpoint text,p256dh text,auth text,kind text,target_type text,claim_token uuid)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_outbox o
   where o.created_at < now()-interval '7 days'
      or (o.status<>'sent' and o.created_at < now()-interval '1 day')
      or (o.status<>'sent' and exists (
        select 1 from public.notifications n
         where n.id=o.notification_id and n.read_at is not null
      ))
      or exists (
        select 1 from public.push_subscriptions s
        join public.profiles p on p.id=s.user_id
        where s.id=o.subscription_id
          and (p.membership_status<>'approved'
               or p.role not in ('member','teacher','founder','admin'))
      );
  update public.push_outbox
     set status='failed',locked_at=null,claim_token=null,
         last_error='Push retry limit reached'
   where status='processing' and attempts>=5
     and locked_at<now()-interval '5 minutes';
  return query
    with claimed as (
      select o.id from public.push_outbox o
       where o.attempts<5 and (
         (o.status in ('pending','retry') and o.next_attempt_at<=now())
         or (o.status='processing' and o.locked_at<now()-interval '5 minutes'))
       order by o.created_at
       limit least(greatest(coalesce(p_limit,10),1),25)
       for update of o skip locked
    ), updated as (
      update public.push_outbox o
         set status='processing',attempts=o.attempts+1,
             locked_at=now(),claim_token=gen_random_uuid()
        from claimed c where o.id=c.id and o.attempts<5
      returning o.id,o.notification_id,o.subscription_id,o.claim_token
    )
    select u.id,u.notification_id,u.subscription_id,s.user_id,
           s.endpoint,s.p256dh,s.auth,n.kind,n.target_type,u.claim_token
      from updated u
      join public.push_subscriptions s on s.id=u.subscription_id
      join public.notifications n on n.id=u.notification_id;
end $$;
revoke all on function public.claim_push_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_push_jobs(integer) to service_role;

create or replace function public.finish_push_job(
  p_id uuid,p_claim_token uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;v_subscription_id uuid;
begin
  if p_outcome not in ('sent','retry','failed','gone') then
    raise exception 'Invalid push delivery outcome';
  end if;
  select attempts,subscription_id into v_attempts,v_subscription_id
    from public.push_outbox
   where id=p_id and claim_token=p_claim_token and status='processing'
   for update;
  if not found then return false; end if;
  if p_outcome='gone' then
    delete from public.push_subscriptions where id=v_subscription_id;
    return true;
  end if;
  update public.push_outbox
     set status=case when p_outcome='retry' and v_attempts<5 then 'retry'
                     when p_outcome='retry' then 'failed' else p_outcome end,
         next_attempt_at=case when p_outcome='retry'
           then now()+make_interval(mins=>least(60,power(2,v_attempts)::integer))
           else next_attempt_at end,
         sent_at=case when p_outcome='sent' then now() else null end,
         last_error=case when p_outcome='sent' then null
                         else left(coalesce(p_error,'Delivery unsuccessful'),300) end,
         locked_at=null,claim_token=null
   where id=p_id;
  return true;
end $$;
revoke all on function public.finish_push_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_push_job(uuid,uuid,text,text) to service_role;
