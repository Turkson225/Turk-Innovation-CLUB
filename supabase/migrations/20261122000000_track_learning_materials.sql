-- Run after the learning dashboards and Drive learning materials upgrades.
-- Keep workshop and library materials in their existing audiences.
begin;

alter table public.learning_materials add column if not exists learning_track text;
alter table public.learning_materials
  drop constraint if exists learning_materials_track_check,
  drop constraint if exists learning_materials_source_check;
alter table public.learning_materials
  add constraint learning_materials_track_check check (
    learning_track is null or (course_id is null and public.valid_learning_tracks(array[learning_track]))
  ),
  add constraint learning_materials_source_check check (
    (
      drive_url is null and file_name is not null
      and storage_path is not null and file_size is not null
    ) or (
      drive_url is not null and (course_id is not null or learning_track is not null)
      and file_name is null and storage_path is null and file_size is null
      and drive_url collate "C" ~ '^https://(drive[.]google[.]com/file/d/[A-Za-z0-9_-]{10,150}/view|docs[.]google[.]com/(presentation|document|spreadsheets)/d/[A-Za-z0-9_-]{10,150}/edit)([?]resourcekey=[A-Za-z0-9_-]{1,200})?$'
    )
  );
create index if not exists learning_materials_track_recent
  on public.learning_materials(learning_track,created_at desc,id) where learning_track is not null;

alter policy "Club reads learning materials" on public.learning_materials using (
  public.is_approved() and (hidden_at is null or public.is_admin()) and (
    public.is_admin()
    or (learning_track is null and (
      course_id is null
      or (public.is_teacher() and exists (
        select 1 from public.courses c where c.id=learning_materials.course_id
          and c.instructor_id=(select auth.uid())
      ))
      or exists (
        select 1 from public.course_enrollments e where e.course_id=learning_materials.course_id
          and e.learner_id=(select auth.uid())
      )
    ))
    or (learning_track is not null and (
      public.teaches_learning_track(learning_track)
      or (
        exists (select 1 from public.profiles p where p.id=(select auth.uid())
          and p.role in ('member','teacher','founder'))
        and (
          exists (select 1 from public.member_learning_paths l where l.user_id=(select auth.uid())
            and learning_materials.learning_track=any(l.tracks))
          or exists (select 1 from public.course_enrollments e join public.courses c on c.id=e.course_id
            where e.learner_id=(select auth.uid()) and public.learning_track_name(c.category)=learning_materials.learning_track)
        )
      )
    ))
  )
);

alter policy "Teachers publish learning materials" on public.learning_materials with check (
  public.is_teacher() and uploaded_by=(select auth.uid()) and hidden_at is null
  and (
    (drive_url is null and split_part(storage_path,'/',1)=(select auth.uid()::text))
    or (drive_url is not null and storage_path is null)
  )
  and (
    (learning_track is not null and course_id is null and public.teaches_learning_track(learning_track))
    or (learning_track is null and (course_id is null or public.is_admin() or exists (
      select 1 from public.courses c where c.id=learning_materials.course_id and c.instructor_id=(select auth.uid())
    )))
  )
);

-- Reading the material row must pass its policy above before the Storage
-- API can create a download link. Keep the existing upload cleanup path.
alter policy "Club downloads learning files" on storage.objects using (
  bucket_id='club-learning' and public.is_approved() and (
    exists (select 1 from public.learning_materials m
      where m.storage_path=storage.objects.name and m.hidden_at is null)
    or (public.is_teacher() and (storage.foldername(name))[1]=(select auth.uid()::text)
      and public.is_unlinked_learning_file(name))
  )
);

commit;
