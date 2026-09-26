-- Run once after upgrade_media_threads.sql in Supabase SQL Editor.
-- Avatars are visible only to approved members and editable only by their owner.

alter table public.profiles add column if not exists avatar_path text;
grant update(avatar_path) on public.profiles to authenticated;
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated
  using (id=(select auth.uid()))
  with check (id=(select auth.uid()) and
    (avatar_path is null or split_part(avatar_path,'/',1)=(select auth.uid()::text)));
drop policy if exists "Approved members see profile photos" on storage.objects;
create policy "Approved members see profile photos" on storage.objects for select to authenticated
  using (bucket_id='club-media' and public.is_approved() and exists(
    select 1 from public.profiles p
    where p.avatar_path=name and p.membership_status='approved'));
