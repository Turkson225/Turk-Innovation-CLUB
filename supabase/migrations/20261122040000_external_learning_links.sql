-- Run after the track, Drive folder and removal migrations. Website links
-- share the same audiences, removal controls and alert queue as other materials.
begin;

alter table public.learning_materials
  add column if not exists external_url text,
  add column if not exists external_library boolean not null default false;

alter table public.learning_materials
  drop constraint if exists learning_materials_source_check,
  drop constraint if exists learning_materials_kind_check;
alter table public.learning_materials
  add constraint learning_materials_kind_check check (
    kind in ('slides','notes','worksheet','guide')
    or (kind = 'video' and (drive_url is not null or external_url is not null))
  ),
  add constraint learning_materials_source_check check (
    (
      drive_url is null and external_url is null and not external_library
      and file_name is not null and storage_path is not null and file_size is not null
    ) or (
      drive_url is not null and external_url is null and not external_library
      and (course_id is not null or learning_track is not null)
      and file_name is null and storage_path is null and file_size is null
      and drive_url collate "C" ~ '^https://(drive[.]google[.]com/(file/d/[A-Za-z0-9_-]{10,150}/view|drive/folders/[A-Za-z0-9_-]{10,150})|docs[.]google[.]com/(presentation|document|spreadsheets)/d/[A-Za-z0-9_-]{10,150}/edit)([?]resourcekey=[A-Za-z0-9_-]{1,200})?$'
    ) or (
      external_url is not null and drive_url is null
      and file_name is null and storage_path is null and file_size is null
      -- A workshop link must never become a club-wide link if its course is removed.
      and external_library = (course_id is null and learning_track is null)
      and char_length(external_url) <= 2000
      and position(chr(92) in external_url) = 0
      and external_url collate "C" ~ '^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?[.]?|[[][0-9A-Fa-f:.]+[]])(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$'
    )
  );

alter policy "Teachers publish learning materials" on public.learning_materials with check (
  public.is_teacher() and uploaded_by=(select auth.uid()) and hidden_at is null
  and (
    (drive_url is null and external_url is null
      and split_part(storage_path,'/',1)=(select auth.uid()::text))
    or ((drive_url is not null or external_url is not null) and storage_path is null)
  )
  and (
    (learning_track is not null and course_id is null and public.teaches_learning_track(learning_track))
    or (learning_track is null and (course_id is null or public.is_admin() or exists (
      select 1 from public.courses c where c.id=learning_materials.course_id and c.instructor_id=(select auth.uid())
    )))
  )
);

notify pgrst, 'reload schema';
commit;
