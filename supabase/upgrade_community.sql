-- SPACE community upgrade. Run in Supabase SQL Editor after schema.sql.
-- Existing projects, accounts and club content are preserved.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member', 'founder', 'admin'));

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,50}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete set null,
  author_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 180),
  storage_path text not null unique,
  file_type text not null default '',
  file_size integer not null check (file_size between 1 and 10485760),
  created_at timestamptz not null default now()
);
create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 3000),
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists channel_messages_recent on public.channel_messages(channel_id, created_at desc);
create index if not exists documents_recent on public.documents(created_at desc);

create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 5 and 180),
  summary text not null check (char_length(summary) between 10 and 1000),
  url text not null check (url ~ '^https://'),
  category text not null default 'Technology',
  status text not null default 'pending' check (status in ('pending','published','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists news_posts_recent on public.news_posts(created_at desc);

create table if not exists public.founder_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  invited_by uuid not null references public.profiles(id) default auth.uid(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.founder_meetings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 3 and 160),
  agenda text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meet_url text check (meet_url is null or meet_url ~ '^https://'),
  created_at timestamptz not null default now(),
  constraint founder_meeting_times check (ends_at > starts_at)
);
create index if not exists founder_meetings_start on public.founder_meetings(starts_at);

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
    where id = (select auth.uid()) and role in ('founder','admin'));
$$;

-- Only a signed-in, email-confirmed recipient can accept a pending invitation.
create or replace function public.accept_founder_invitation()
returns void language plpgsql security definer set search_path = public as $$
declare v_email text; v_invite uuid;
begin
  select lower(email) into v_email from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email before accepting an invitation'; end if;
  update public.founder_invites set accepted_at = now()
  where email = v_email and accepted_at is null returning id into v_invite;
  if v_invite is null then raise exception 'No pending founder invitation for this account'; end if;
  update public.profiles set role = 'founder'
  where id = auth.uid() and role = 'member';
end $$;
revoke all on function public.accept_founder_invitation() from public, anon;
grant execute on function public.accept_founder_invitation() to authenticated;

insert into public.channels(slug,name,description) values
  ('general','General','Club updates, introductions and everyday conversation.'),
  ('project-lab','Project lab','Prototypes, design reviews and build progress.'),
  ('technical-help','Technical help','Ask for help with circuits, code and CAD.'),
  ('opportunities','Opportunities','Competitions, internships and events.')
on conflict (slug) do nothing;

insert into storage.buckets(id,name,public,file_size_limit)
values ('club-documents','club-documents',false,10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

alter table public.channels enable row level security;
alter table public.documents enable row level security;
alter table public.channel_messages enable row level security;
alter table public.news_posts enable row level security;
alter table public.founder_invites enable row level security;
alter table public.founder_meetings enable row level security;

revoke all on public.channels,public.documents,public.channel_messages,
  public.news_posts,public.founder_invites,public.founder_meetings from anon,authenticated;
grant select on public.channels,public.documents,public.channel_messages,
  public.news_posts,public.founder_invites,public.founder_meetings to authenticated;
grant insert on public.channels,public.documents,public.channel_messages,
  public.news_posts,public.founder_invites,public.founder_meetings to authenticated;
grant update(status) on public.news_posts to authenticated;
grant update(title,agenda,starts_at,ends_at,meet_url) on public.founder_meetings to authenticated;

create policy "Members see channels" on public.channels for select to authenticated using (true);
create policy "Admins create channels" on public.channels for insert to authenticated
  with check (public.is_admin());
create policy "Members see shared documents" on public.documents for select to authenticated using (true);
create policy "Members share own documents" on public.documents for insert to authenticated
  with check (author_id = (select auth.uid())
    and split_part(storage_path,'/',1) = (select auth.uid()::text));
create policy "Members read channel messages" on public.channel_messages for select to authenticated using (true);
create policy "Members send messages" on public.channel_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and
    (document_id is null or exists (select 1 from public.documents d
      where d.id = document_id and d.channel_id = channel_id and d.author_id = (select auth.uid()))));
create policy "Members see published or own news" on public.news_posts for select to authenticated
  using (status = 'published' or submitted_by = (select auth.uid()) or public.is_admin());
create policy "Members submit news" on public.news_posts for insert to authenticated
  with check (submitted_by = (select auth.uid()) and status = 'pending');
create policy "Admins review news" on public.news_posts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Recipients and admins see invitations" on public.founder_invites for select to authenticated
  using (public.is_admin() or email = lower((select auth.jwt()->>'email')));
create policy "Admins invite founders" on public.founder_invites for insert to authenticated
  with check (public.is_admin() and invited_by = (select auth.uid()));
create policy "Founders see their meetings" on public.founder_meetings for select to authenticated
  using (public.is_founder());
create policy "Founders schedule meetings" on public.founder_meetings for insert to authenticated
  with check (public.is_founder() and host_id = (select auth.uid()));
create policy "Hosts edit meetings" on public.founder_meetings for update to authenticated
  using (public.is_founder() and (host_id = (select auth.uid()) or public.is_admin()))
  with check (public.is_founder() and (host_id = (select auth.uid()) or public.is_admin()));

create policy "Members download club files" on storage.objects for select to authenticated
  using (bucket_id = 'club-documents');
create policy "Members upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'club-documents'
    and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Members clean up own files" on storage.objects for delete to authenticated
  using (bucket_id = 'club-documents'
    and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Realtime adds instant message updates; the browser also polls if the socket is unavailable.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists(select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channel_messages') then
    alter publication supabase_realtime add table public.channel_messages;
  end if;
end $$;
