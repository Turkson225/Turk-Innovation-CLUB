-- Run after the classroom access and teacher materials migrations.
-- Run this file in full; it preserves the existing Storage uploads and RLS.
begin;

alter table public.learning_materials
  add column if not exists drive_url text,
  alter column file_name drop not null,
  alter column storage_path drop not null,
  alter column file_size drop not null;

alter table public.learning_materials
  drop constraint if exists learning_materials_source_check,
  drop constraint if exists learning_materials_kind_check;
alter table public.learning_materials
  add constraint learning_materials_kind_check check (
    kind in ('slides','notes','worksheet','guide')
    or (kind = 'video' and drive_url is not null)
  ),
  add constraint learning_materials_source_check check (
    (
      drive_url is null and file_name is not null
      and storage_path is not null and file_size is not null
    ) or (
      drive_url is not null and course_id is not null
      and file_name is null and storage_path is null and file_size is null
      and drive_url collate "C" ~ '^https://(drive[.]google[.]com/file/d/[A-Za-z0-9_-]{10,150}/view|docs[.]google[.]com/(presentation|document|spreadsheets)/d/[A-Za-z0-9_-]{10,150}/edit)([?]resourcekey=[A-Za-z0-9_-]{1,200})?$'
    )
  );

-- Keep the existing upload owner and assigned workshop checks. Drive links
-- use the same read/hide policies as uploaded course material.
alter policy "Teachers publish learning materials" on public.learning_materials
  with check (
    public.is_teacher()
    and uploaded_by = (select auth.uid())
    and hidden_at is null
    and (
      (drive_url is null and split_part(storage_path, '/', 1) = (select auth.uid()::text))
      or (drive_url is not null and course_id is not null and storage_path is null)
    )
    and (
      course_id is null or public.is_admin()
      or exists (
        select 1 from public.courses c
        where c.id = learning_materials.course_id and c.instructor_id = (select auth.uid())
      )
    )
  );

commit;
