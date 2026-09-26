-- Run once in a new Supabase project's SQL Editor.
-- Use the publishable / anon key in the website. Never expose service_role.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'New member',
  programme text not null default '',
  skills text not null default '',
  role text not null default 'member' check (role in ('member','admin')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,full_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), 'New member'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_member();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create table if not exists public.founders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  role text not null,
  bio text not null default '',
  link_url text,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null default '',
  description text not null default '',
  status text not null default 'planning' check (status in ('planning','building','testing','complete')),
  progress integer not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now()
);
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  status text not null default 'todo' check (status in ('todo','done')),
  due_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id),
  project_id uuid references public.projects(id) on delete set null,
  category text not null default 'General',
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Automation',
  level text not null default 'Beginner',
  description text not null default '',
  starts_at timestamptz,
  resource_url text,
  created_at timestamptz not null default now()
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default 'Online',
  meet_url text,
  created_at timestamptz not null default now(),
  constraint event_time_valid check (ends_at > starts_at)
);
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  created_at timestamptz not null default now()
);

create index if not exists profiles_presence_idx on public.profiles(last_seen_at);
create index if not exists projects_created_idx on public.projects(created_at desc);
create index if not exists project_tasks_project_idx on public.project_tasks(project_id);
create index if not exists replies_topic_idx on public.replies(topic_id);
create index if not exists events_start_idx on public.events(starts_at);

alter table public.profiles enable row level security;
alter table public.founders enable row level security;
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.topics enable row level security;
alter table public.replies enable row level security;
alter table public.courses enable row level security;
alter table public.events enable row level security;
alter table public.announcements enable row level security;

-- Column grants keep a member from changing role, id, ownership or timestamps.
revoke all on public.profiles,public.founders,public.projects,public.project_tasks,public.topics,public.replies,public.courses,public.events,public.announcements from anon,authenticated;
grant usage on schema public to anon,authenticated;
grant select on public.founders to anon;
grant select on public.profiles,public.founders,public.projects,public.project_tasks,public.topics,public.replies,public.courses,public.events,public.announcements to authenticated;
grant update(full_name,programme,skills,last_seen_at) on public.profiles to authenticated;
grant insert on public.founders,public.projects,public.project_tasks,public.topics,public.replies,public.courses,public.events,public.announcements to authenticated;
grant update(title,summary,description,status,progress) on public.projects to authenticated;
grant update(status) on public.project_tasks to authenticated;

create policy "Member directory" on public.profiles for select to authenticated using (true);
create policy "Update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Public founder directory" on public.founders for select to anon,authenticated using (true);
create policy "Admin publishes founders" on public.founders for insert to authenticated with check (public.is_admin());

create policy "Members view projects" on public.projects for select to authenticated using (true);
create policy "Members create own projects" on public.projects for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners edit projects" on public.projects for update to authenticated using (owner_id = (select auth.uid()) or public.is_admin()) with check (owner_id = (select auth.uid()) or public.is_admin());
create policy "Members view tasks" on public.project_tasks for select to authenticated using (true);
create policy "Owners create tasks" on public.project_tasks for insert to authenticated with check (exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin())));
create policy "Owners complete tasks" on public.project_tasks for update to authenticated using (exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin()))) with check (exists(select 1 from public.projects p where p.id=project_id and (p.owner_id=(select auth.uid()) or public.is_admin())));

create policy "Members view topics" on public.topics for select to authenticated using (true);
create policy "Members start topics" on public.topics for insert to authenticated with check (author_id=(select auth.uid()));
create policy "Members view replies" on public.replies for select to authenticated using (true);
create policy "Members reply" on public.replies for insert to authenticated with check (author_id=(select auth.uid()));
create policy "Members view courses" on public.courses for select to authenticated using (true);
create policy "Admins publish courses" on public.courses for insert to authenticated with check (public.is_admin());
create policy "Members view events" on public.events for select to authenticated using (true);
create policy "Admins schedule events" on public.events for insert to authenticated with check (public.is_admin());
create policy "Members view announcements" on public.announcements for select to authenticated using (true);
create policy "Admins publish announcements" on public.announcements for insert to authenticated with check (public.is_admin());
