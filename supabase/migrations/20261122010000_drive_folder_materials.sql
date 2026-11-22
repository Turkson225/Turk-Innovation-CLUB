-- Run after the track learning materials upgrade. The only change here is
-- accepting canonical Google Drive folder links alongside existing file links.
begin;

alter table public.learning_materials
  drop constraint if exists learning_materials_source_check;
alter table public.learning_materials
  add constraint learning_materials_source_check check (
    (
      drive_url is null and file_name is not null
      and storage_path is not null and file_size is not null
    ) or (
      drive_url is not null and (course_id is not null or learning_track is not null)
      and file_name is null and storage_path is null and file_size is null
      and drive_url collate "C" ~ '^https://(drive[.]google[.]com/(file/d/[A-Za-z0-9_-]{10,150}/view|drive/folders/[A-Za-z0-9_-]{10,150})|docs[.]google[.]com/(presentation|document|spreadsheets)/d/[A-Za-z0-9_-]{10,150}/edit)([?]resourcekey=[A-Za-z0-9_-]{1,200})?$'
    )
  );

commit;
