-- Run once after upgrade_roles_investors.sql in Supabase SQL Editor.
-- Only approved teachers/admins publish learning files; approved club members read them.

create table if not exists public.learning_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete set null,
  uploaded_by uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '' check (char_length(description) <= 1500),
  kind text not null check (kind in ('slides','notes','worksheet','guide')),
  file_name text not null check (char_length(file_name) between 1 and 240),
  storage_path text not null unique,
  file_size integer not null check (file_size between 1 and 20971520),
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists learning_materials_course_recent on public.learning_materials(course_id,created_at desc);
alter table public.learning_materials enable row level security;
revoke all on public.learning_materials from anon,authenticated;
grant select,insert on public.learning_materials to authenticated;
grant update(hidden_at) on public.learning_materials to authenticated;
drop policy if exists "Club reads learning materials" on public.learning_materials;
create policy "Club reads learning materials" on public.learning_materials for select to authenticated
  using (public.is_approved() and (hidden_at is null or public.is_admin()));
drop policy if exists "Teachers publish learning materials" on public.learning_materials;
create policy "Teachers publish learning materials" on public.learning_materials for insert to authenticated
  with check (public.is_teacher() and uploaded_by=(select auth.uid()) and hidden_at is null
    and split_part(storage_path,'/',1)=(select auth.uid()::text));
drop policy if exists "Admins hide learning materials" on public.learning_materials;
create policy "Admins hide learning materials" on public.learning_materials for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('club-learning','club-learning',false,20971520,
  array['application/pdf','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=20971520,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Teachers upload learning files" on storage.objects;
create policy "Teachers upload learning files" on storage.objects for insert to authenticated
  with check (bucket_id='club-learning' and public.is_teacher()
    and (storage.foldername(name))[1]=(select auth.uid()::text));
drop policy if exists "Club downloads learning files" on storage.objects;
create policy "Club downloads learning files" on storage.objects for select to authenticated
  using (bucket_id='club-learning' and public.is_approved() and exists(
    select 1 from public.learning_materials m where m.storage_path=name and m.hidden_at is null));
drop policy if exists "Teachers clean up own learning files" on storage.objects;
create policy "Teachers clean up own learning files" on storage.objects for delete to authenticated
  using (bucket_id='club-learning' and public.is_teacher()
    and (storage.foldername(name))[1]=(select auth.uid()::text));
