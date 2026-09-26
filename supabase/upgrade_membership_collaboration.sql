-- Run once after schema.sql and upgrade_community.sql in Supabase SQL Editor.
-- Existing accounts remain approved. New accounts require administrator review.

alter table public.profiles add column if not exists membership_status text not null default 'pending'
  check (membership_status in ('pending','approved','rejected','suspended'));
alter table public.profiles add column if not exists application_reason text not null default '';
alter table public.profiles add column if not exists handle text;
update public.profiles p set membership_status = 'approved'
where membership_status = 'pending' and exists
  (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null);
update public.profiles set handle = 'member_' || left(replace(id::text,'-',''),12) where handle is null;
alter table public.profiles alter column handle set not null;
alter table public.profiles add constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,30}$');
create unique index if not exists profiles_handle_unique on public.profiles(handle);
grant update(application_reason,handle) on public.profiles to authenticated;

create or replace function public.handle_new_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,full_name,handle)
  values (new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),'New member'),
    'member_' || left(replace(new.id::text,'-',''),12))
  on conflict (id) do nothing;
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    select id,'application','New club membership application','application',new.id
    from public.profiles where role='admin' and membership_status='approved';
  return new;
end $$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
    where id = (select auth.uid()) and membership_status = 'approved');
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
    where id = (select auth.uid()) and membership_status = 'approved' and role = 'admin');
$$;
create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
    where id = (select auth.uid()) and membership_status = 'approved' and role in ('founder','admin'));
$$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon,authenticated;
grant select on public.audit_events to authenticated;
create policy "Admins review audit events" on public.audit_events for select to authenticated
  using (public.is_admin());

create or replace function public.review_membership(p_user uuid,p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('approved','rejected','suspended') then raise exception 'Invalid review decision'; end if;
  if p_user = auth.uid() then raise exception 'You cannot review your own membership'; end if;
  update public.profiles set membership_status = p_status where id = p_user and role <> 'admin';
  if not found then raise exception 'Member not found or cannot be changed'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values (auth.uid(),'membership_'||p_status,'profile',p_user);
  if p_status='approved' then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(p_user,'membership','Your club membership was approved','application',p_user);
  end if;
end $$;
revoke all on function public.review_membership(uuid,text) from public,anon;
grant execute on function public.review_membership(uuid,text) to authenticated;

-- Founder invitations also require an approved membership.
create or replace function public.accept_founder_invitation()
returns void language plpgsql security definer set search_path = public as $$
declare v_email text; v_invite uuid;
begin
  if not public.is_approved() then raise exception 'Membership approval required'; end if;
  select lower(email) into v_email from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email first'; end if;
  update public.founder_invites set accepted_at = now()
  where email = v_email and accepted_at is null returning id into v_invite;
  if v_invite is null then raise exception 'No pending founder invitation'; end if;
  update public.profiles set role = 'founder' where id = auth.uid() and role = 'member';
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values (auth.uid(),'founder_accepted','founder_invite',v_invite);
end $$;
revoke all on function public.accept_founder_invitation() from public,anon;
grant execute on function public.accept_founder_invitation() to authenticated;

-- Channel replies, editing, reactions and read positions.
alter table public.channel_messages add column if not exists parent_id uuid references public.channel_messages(id) on delete set null;
alter table public.channel_messages add column if not exists edited_at timestamptz;
alter table public.channel_messages add column if not exists deleted_at timestamptz;
create index if not exists channel_messages_parent_idx on public.channel_messages(parent_id);
create table if not exists public.message_reactions (
  message_id uuid not null references public.channel_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍','💡','🔥','🎯')),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id,emoji)
);
create table if not exists public.channel_reads (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(channel_id,user_id)
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  target_type text not null,
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_recent on public.notifications(user_id,created_at desc);
alter table public.message_reactions enable row level security;
alter table public.channel_reads enable row level security;
alter table public.notifications enable row level security;
revoke all on public.message_reactions,public.channel_reads,public.notifications from anon,authenticated;
grant select on public.message_reactions,public.channel_reads,public.notifications to authenticated;
grant insert,delete on public.message_reactions to authenticated;
grant insert on public.channel_reads to authenticated;
grant update(last_read_at) on public.channel_reads to authenticated;
grant update(read_at) on public.notifications to authenticated;
create policy "Approved members see reactions" on public.message_reactions for select to authenticated using (public.is_approved());
create policy "Members react once" on public.message_reactions for insert to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()));
create policy "Members remove own reactions" on public.message_reactions for delete to authenticated
  using (public.is_approved() and user_id = (select auth.uid()));
create policy "Members read own channel positions" on public.channel_reads for select to authenticated
  using (public.is_approved() and user_id = (select auth.uid()));
create policy "Members mark own channels" on public.channel_reads for insert to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()));
create policy "Members update own channel positions" on public.channel_reads for update to authenticated
  using (public.is_approved() and user_id = (select auth.uid()))
  with check (public.is_approved() and user_id = (select auth.uid()));
create policy "Members see own notifications" on public.notifications for select to authenticated
  using (public.is_approved() and user_id = (select auth.uid()));
create policy "Members mark own notifications" on public.notifications for update to authenticated
  using (public.is_approved() and user_id = (select auth.uid()))
  with check (public.is_approved() and user_id = (select auth.uid()));

create or replace function public.edit_channel_message(p_id uuid,p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() or char_length(trim(p_body)) not between 1 and 3000 then
    raise exception 'Invalid message'; end if;
  update public.channel_messages set body = trim(p_body), edited_at = now()
    where id = p_id and author_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'Message cannot be edited'; end if;
end $$;
create or replace function public.remove_channel_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then raise exception 'Membership required'; end if;
  update public.channel_messages set body = '[Message removed]', deleted_at = now()
    where id = p_id and deleted_at is null and (author_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Message cannot be removed'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values (auth.uid(),'message_removed','channel_message',p_id);
end $$;
revoke all on function public.edit_channel_message(uuid,text),public.remove_channel_message(uuid) from public,anon;
grant execute on function public.edit_channel_message(uuid,text),public.remove_channel_message(uuid) to authenticated;

create or replace function public.notify_channel_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_match text[]; v_author uuid;
begin
  if new.parent_id is not null then
    select author_id into v_author from public.channel_messages where id = new.parent_id;
    if v_author is not null and v_author <> new.author_id then
      insert into public.notifications(user_id,kind,title,target_type,target_id)
        values(v_author,'reply','Someone replied to your message','channel',new.channel_id);
    end if;
  end if;
  for v_match in select regexp_matches(lower(new.body),'@([a-z0-9_]{3,30})','g') loop
    insert into public.notifications(user_id,kind,title,target_type,target_id)
    select id,'mention','You were mentioned in a channel','channel',new.channel_id
    from public.profiles where handle = v_match[1] and id <> new.author_id and membership_status = 'approved';
  end loop;
  return new;
end $$;
drop trigger if exists on_channel_message_insert on public.channel_messages;
create trigger on_channel_message_insert after insert on public.channel_messages
for each row execute function public.notify_channel_message();

-- Project collaborators, milestone deadlines and assignments.
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(project_id,user_id)
);
insert into public.project_members(project_id,user_id)
  select id,owner_id from public.projects on conflict do nothing;
create or replace function public.add_project_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members(project_id,user_id) values(new.id,new.owner_id)
    on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_project_created_membership on public.projects;
create trigger on_project_created_membership after insert on public.projects
for each row execute function public.add_project_owner();
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now()
);
alter table public.project_tasks add column if not exists assignee_id uuid references public.profiles(id) on delete set null;
alter table public.project_tasks add column if not exists milestone_id uuid references public.project_milestones(id) on delete set null;
create index if not exists project_milestones_project_idx on public.project_milestones(project_id);
alter table public.project_members enable row level security;
alter table public.project_milestones enable row level security;
revoke all on public.project_members,public.project_milestones from anon,authenticated;
grant select,insert,delete on public.project_members to authenticated;
grant select,insert on public.project_milestones to authenticated;
grant update(status) on public.project_milestones to authenticated;
create policy "Members see project teams" on public.project_members for select to authenticated using (public.is_approved());
create policy "Owners add collaborators" on public.project_members for insert to authenticated
  with check (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin()))
    and exists(select 1 from public.profiles p where p.id=user_id and p.membership_status='approved'));
create policy "Owners remove collaborators" on public.project_members for delete to authenticated
  using (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and p.owner_id<>user_id and (p.owner_id=(select auth.uid()) or public.is_admin())));
create policy "Members see milestones" on public.project_milestones for select to authenticated using (public.is_approved());
create policy "Owners plan milestones" on public.project_milestones for insert to authenticated
  with check (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin())));
create policy "Owners complete milestones" on public.project_milestones for update to authenticated
  using (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin())))
  with check (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin())));

create or replace function public.assign_project_task(p_task uuid,p_assignee uuid,p_milestone uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_tasks where id=p_task;
  if v_project is null or not public.is_approved() or not exists
    (select 1 from public.projects where id=v_project and (owner_id=auth.uid() or public.is_admin())) then
    raise exception 'Project owner access required'; end if;
  if p_assignee is not null and not exists
    (select 1 from public.project_members where project_id=v_project and user_id=p_assignee) then
    raise exception 'Assignee must belong to the project'; end if;
  if p_milestone is not null and not exists
    (select 1 from public.project_milestones where id=p_milestone and project_id=v_project) then
    raise exception 'Milestone belongs to another project'; end if;
  update public.project_tasks set assignee_id=p_assignee,milestone_id=p_milestone where id=p_task;
end $$;
revoke all on function public.assign_project_task(uuid,uuid,uuid) from public,anon;
grant execute on function public.assign_project_task(uuid,uuid,uuid) to authenticated;

create or replace function public.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null then
    if tg_op = 'INSERT' then
      insert into public.notifications(user_id,kind,title,target_type,target_id)
        values(new.assignee_id,'task','You were assigned a project task','project',new.project_id);
    elsif new.assignee_id is distinct from old.assignee_id then
      insert into public.notifications(user_id,kind,title,target_type,target_id)
        values(new.assignee_id,'task','You were assigned a project task','project',new.project_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists on_task_assignment on public.project_tasks;
create trigger on_task_assignment after insert or update of assignee_id on public.project_tasks
for each row execute function public.notify_task_assignment();

-- Meeting RSVPs and private reminders visible in the member dashboard.
create table if not exists public.event_rsvps (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('going','maybe','not_going')),
  updated_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create table if not exists public.founder_meeting_rsvps (
  meeting_id uuid not null references public.founder_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('going','maybe','not_going')),
  updated_at timestamptz not null default now(),
  primary key(meeting_id,user_id)
);
alter table public.event_rsvps enable row level security;
alter table public.founder_meeting_rsvps enable row level security;
revoke all on public.event_rsvps,public.founder_meeting_rsvps from anon,authenticated;
grant select,insert on public.event_rsvps,public.founder_meeting_rsvps to authenticated;
grant update(response,updated_at) on public.event_rsvps,public.founder_meeting_rsvps to authenticated;
create policy "Members see event responses" on public.event_rsvps for select to authenticated using (public.is_approved());
create policy "Members respond to events" on public.event_rsvps for insert to authenticated
  with check (public.is_approved() and user_id=(select auth.uid()));
create policy "Members change event response" on public.event_rsvps for update to authenticated
  using (public.is_approved() and user_id=(select auth.uid())) with check (public.is_approved() and user_id=(select auth.uid()));
grant update(meet_url) on public.events to authenticated;
create policy "Admins add event Meet links" on public.events for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Founders see meeting responses" on public.founder_meeting_rsvps for select to authenticated using (public.is_founder());
create policy "Founders respond to meetings" on public.founder_meeting_rsvps for insert to authenticated
  with check (public.is_founder() and user_id=(select auth.uid()));
create policy "Founders change meeting response" on public.founder_meeting_rsvps for update to authenticated
  using (public.is_founder() and user_id=(select auth.uid())) with check (public.is_founder() and user_id=(select auth.uid()));

-- Versioned resources and moderation reports.
alter table public.documents add column if not exists hidden_at timestamptz;
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id),
  file_size integer not null check (file_size between 1 and 10485760),
  created_at timestamptz not null default now()
);
insert into public.document_versions(document_id,storage_path,uploaded_by,file_size,created_at)
  select id,storage_path,author_id,file_size,created_at from public.documents on conflict (storage_path) do nothing;
create or replace function public.track_document_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.document_versions(document_id,storage_path,uploaded_by,file_size)
      values(new.id,new.storage_path,auth.uid(),new.file_size) on conflict (storage_path) do nothing;
  elsif new.storage_path is distinct from old.storage_path then
    insert into public.document_versions(document_id,storage_path,uploaded_by,file_size)
      values(new.id,new.storage_path,auth.uid(),new.file_size) on conflict (storage_path) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_document_version on public.documents;
create trigger on_document_version after insert or update of storage_path on public.documents
for each row execute function public.track_document_version();
alter table public.document_versions enable row level security;
revoke all on public.document_versions from anon,authenticated;
grant select on public.document_versions to authenticated;
grant update(storage_path,file_size,file_type) on public.documents to authenticated;
create policy "Members see visible versions" on public.document_versions for select to authenticated
  using (public.is_approved() and exists(select 1 from public.documents d where d.id=document_id and d.hidden_at is null));
create policy "Owners update document versions" on public.documents for update to authenticated
  using (public.is_approved() and hidden_at is null and (author_id=(select auth.uid()) or public.is_admin()))
  with check (public.is_approved() and hidden_at is null and (author_id=(select auth.uid()) or public.is_admin())
    and split_part(storage_path,'/',1)=(select auth.uid()::text));

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  target_type text not null check (target_type in ('message','document','news')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 10 and 1000),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
revoke all on public.reports from anon,authenticated;
grant select,insert on public.reports to authenticated;
grant update(status) on public.reports to authenticated;
create policy "Members see own reports admins see all" on public.reports for select to authenticated
  using (public.is_approved() and (reporter_id=(select auth.uid()) or public.is_admin()));
create policy "Members submit reports" on public.reports for insert to authenticated
  with check (public.is_approved() and reporter_id=(select auth.uid()) and status='open');
create policy "Admins resolve reports" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.moderate_content(p_type text,p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_type='message' then
    update public.channel_messages set body='[Message removed]',deleted_at=now() where id=p_id and deleted_at is null;
  elsif p_type='document' then
    update public.documents set hidden_at=now() where id=p_id and hidden_at is null;
  elsif p_type='news' then
    update public.news_posts set status='rejected' where id=p_id;
  else raise exception 'Invalid content type'; end if;
  if not found then raise exception 'Content not found'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'content_removed',p_type,p_id);
end $$;
revoke all on function public.moderate_content(text,uuid) from public,anon;
grant execute on function public.moderate_content(text,uuid) to authenticated;

-- Replace legacy policies: an authenticated account is no longer enough to access club data.
drop policy if exists "Member directory" on public.profiles;
create policy "Member directory" on public.profiles for select to authenticated
  using ((id=(select auth.uid())) or public.is_admin() or (public.is_approved() and membership_status='approved'));
drop policy if exists "Members view projects" on public.projects;
create policy "Members view projects" on public.projects for select to authenticated using (public.is_approved());
drop policy if exists "Members create own projects" on public.projects;
create policy "Members create own projects" on public.projects for insert to authenticated
  with check (public.is_approved() and owner_id=(select auth.uid()));
drop policy if exists "Owners edit projects" on public.projects;
create policy "Owners edit projects" on public.projects for update to authenticated
  using (public.is_approved() and (owner_id=(select auth.uid()) or public.is_admin()))
  with check (public.is_approved() and (owner_id=(select auth.uid()) or public.is_admin()));
drop policy if exists "Members view tasks" on public.project_tasks;
create policy "Members view tasks" on public.project_tasks for select to authenticated using (public.is_approved());
drop policy if exists "Owners create tasks" on public.project_tasks;
create policy "Owners create tasks" on public.project_tasks for insert to authenticated
  with check (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin()))
    and (assignee_id is null or exists(select 1 from public.project_members pm where pm.project_id=project_id and pm.user_id=assignee_id))
    and (milestone_id is null or exists(select 1 from public.project_milestones m where m.id=milestone_id and m.project_id=project_id)));
drop policy if exists "Owners complete tasks" on public.project_tasks;
create policy "Owners complete tasks" on public.project_tasks for update to authenticated
  using (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin()))
    or (public.is_approved() and assignee_id=(select auth.uid())))
  with check (public.is_approved() and exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin()))
    or (public.is_approved() and assignee_id=(select auth.uid())));
drop policy if exists "Members view topics" on public.topics;
create policy "Members view topics" on public.topics for select to authenticated using (public.is_approved());
drop policy if exists "Members start topics" on public.topics;
create policy "Members start topics" on public.topics for insert to authenticated with check (public.is_approved() and author_id=(select auth.uid()));
drop policy if exists "Members view replies" on public.replies;
create policy "Members view replies" on public.replies for select to authenticated using (public.is_approved());
drop policy if exists "Members reply" on public.replies;
create policy "Members reply" on public.replies for insert to authenticated with check (public.is_approved() and author_id=(select auth.uid()));
drop policy if exists "Members view courses" on public.courses;
create policy "Members view courses" on public.courses for select to authenticated using (public.is_approved());
drop policy if exists "Members view events" on public.events;
create policy "Members view events" on public.events for select to authenticated using (public.is_approved());
drop policy if exists "Members view announcements" on public.announcements;
create policy "Members view announcements" on public.announcements for select to authenticated using (public.is_approved());
drop policy if exists "Members see channels" on public.channels;
create policy "Members see channels" on public.channels for select to authenticated using (public.is_approved());
drop policy if exists "Members see shared documents" on public.documents;
create policy "Members see shared documents" on public.documents for select to authenticated
  using (public.is_approved() and hidden_at is null);
drop policy if exists "Members share own documents" on public.documents;
create policy "Members share own documents" on public.documents for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid()) and split_part(storage_path,'/',1)=(select auth.uid()::text));
drop policy if exists "Members read channel messages" on public.channel_messages;
create policy "Members read channel messages" on public.channel_messages for select to authenticated using (public.is_approved());
drop policy if exists "Members send messages" on public.channel_messages;
create policy "Members send messages" on public.channel_messages for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and (parent_id is null or exists(select 1 from public.channel_messages parent where parent.id=parent_id and parent.channel_id=channel_id and parent.parent_id is null))
    and (document_id is null or exists(select 1 from public.documents d where d.id=document_id and d.channel_id=channel_id and d.author_id=(select auth.uid()))));
drop policy if exists "Members see published or own news" on public.news_posts;
create policy "Members see published or own news" on public.news_posts for select to authenticated
  using (public.is_approved() and (status='published' or submitted_by=(select auth.uid()) or public.is_admin()));
drop policy if exists "Members submit news" on public.news_posts;
create policy "Members submit news" on public.news_posts for insert to authenticated
  with check (public.is_approved() and submitted_by=(select auth.uid()) and status='pending');
drop policy if exists "Recipients and admins see invitations" on public.founder_invites;
create policy "Recipients and admins see invitations" on public.founder_invites for select to authenticated
  using (public.is_approved() and (public.is_admin() or email=lower((select auth.jwt()->>'email'))));
drop policy if exists "Members download club files" on storage.objects;
create policy "Members download club files" on storage.objects for select to authenticated
  using (bucket_id='club-documents' and public.is_approved() and exists(
    select 1 from public.document_versions v join public.documents d on d.id=v.document_id
    where v.storage_path=name and d.hidden_at is null));
drop policy if exists "Members upload to own folder" on storage.objects;
create policy "Members upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id='club-documents' and public.is_approved() and (storage.foldername(name))[1]=(select auth.uid()::text));
drop policy if exists "Members clean up own files" on storage.objects;
create policy "Members clean up own files" on storage.objects for delete to authenticated
  using (bucket_id='club-documents' and public.is_approved() and (storage.foldername(name))[1]=(select auth.uid()::text));

-- Explicit approved checks for policies that previously depended only on role/ownership.
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated
  using (id=(select auth.uid())) with check (id=(select auth.uid()));
drop policy if exists "Admins publish founders" on public.founders;
create policy "Admins publish founders" on public.founders for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins publish courses" on public.courses;
create policy "Admins publish courses" on public.courses for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins schedule events" on public.events;
create policy "Admins schedule events" on public.events for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins publish announcements" on public.announcements;
create policy "Admins publish announcements" on public.announcements for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins create channels" on public.channels;
create policy "Admins create channels" on public.channels for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins review news" on public.news_posts;
create policy "Admins review news" on public.news_posts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins invite founders" on public.founder_invites;
create policy "Admins invite founders" on public.founder_invites for insert to authenticated
  with check (public.is_admin() and invited_by=(select auth.uid()));
