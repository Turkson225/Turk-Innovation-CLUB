-- Run once after schema.sql, upgrade_membership_collaboration.sql and
-- upgrade_founder_teaching_roles.sql in Supabase SQL Editor.
-- Founder cards are public. Publish portraits only with each person's consent.

alter table public.founders add column if not exists portrait_path text;

-- A founder's portrait must live under that card's UUID. The filename is a
-- random UUID plus a web image extension; an admin cannot point a card at an
-- unrelated bucket object or a private club member photo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.founders'::regclass
      and conname = 'founders_portrait_path_format'
  ) then
    alter table public.founders
      add constraint founders_portrait_path_format
      check (portrait_path is null or portrait_path ~
        ('^' || id::text || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'));
  end if;
end $$;

-- Keep edits limited to the public card fields. The existing delete policy and
-- deletion audit from upgrade_founder_teaching_roles.sql remain in force.
grant update(name,role,bio,link_url,portrait_path,sort_order)
  on public.founders to authenticated;
drop policy if exists "Admins edit public founder cards" on public.founders;
create policy "Admins edit public founder cards"
  on public.founders for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Public Storage URL access serves the photograph to signed-out visitors.
-- The bucket restricts upload size and MIME type independently of the form.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('club-founder-portraits','club-founder-portraits',true,5242880,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,
  allowed_mime_types=excluded.allowed_mime_types;

-- Storage's remove and replace APIs also check SELECT on the object. Public
-- URL reads use the public bucket and do not need an anonymous SELECT policy.
drop policy if exists "Admins inspect founder portraits" on storage.objects;
create policy "Admins inspect founder portraits"
  on storage.objects for select to authenticated
  using (bucket_id = 'club-founder-portraits' and (select public.is_admin()));

-- Only an approved administrator may upload. The folder has to identify an
-- existing founder card; UUID filenames make new uploads safe without upsert.
drop policy if exists "Admins upload founder portraits" on storage.objects;
create policy "Admins upload founder portraits"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'club-founder-portraits'
    and (select public.is_admin())
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'
    and exists (
      select 1 from public.founders f
      where f.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "Admins replace founder portraits" on storage.objects;
create policy "Admins replace founder portraits"
  on storage.objects for update to authenticated
  using (bucket_id = 'club-founder-portraits' and (select public.is_admin()))
  with check (
    bucket_id = 'club-founder-portraits'
    and (select public.is_admin())
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'
    and exists (
      select 1 from public.founders f
      where f.id::text = (storage.foldername(name))[1]
    )
  );

-- An administrator may clean up an orphaned photograph after deleting its
-- founder card, so deletion deliberately does not require a matching row.
drop policy if exists "Admins remove founder portraits" on storage.objects;
create policy "Admins remove founder portraits"
  on storage.objects for delete to authenticated
  using (bucket_id = 'club-founder-portraits' and (select public.is_admin()));
