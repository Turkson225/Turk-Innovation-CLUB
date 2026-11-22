-- Run after the track learning materials migration. Removing a material
-- hides its SPACE entry and blocks new Storage download links for that entry.
begin;

alter table public.learning_materials add column if not exists teacher_can_restore boolean not null default false;
alter table public.learning_materials drop constraint if exists learning_materials_restore_hidden_check;
alter table public.learning_materials add constraint learning_materials_restore_hidden_check
  check (hidden_at is not null or not teacher_can_restore);

create or replace function public.can_manage_learning_material(p_uploader uuid,p_course uuid,p_track text)
returns boolean language sql stable security invoker set search_path='' as $$
  select public.is_admin() or (
    public.is_teacher() and p_uploader=(select auth.uid()) and (
      (p_track is not null and p_course is null and public.teaches_learning_track(p_track))
      or (p_track is null and (p_course is null or exists (
        select 1 from public.courses c where c.id=p_course and c.instructor_id=(select auth.uid())
      )))
    )
  );
$$;
revoke all on function public.can_manage_learning_material(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.can_manage_learning_material(uuid,uuid,text) to authenticated;

-- Students still use the existing read policy. Only the publisher with
-- current teaching access (or an admin) can read a removed entry for restoration.
drop policy if exists "Publishers can review removed materials" on public.learning_materials;
create policy "Publishers can review removed materials" on public.learning_materials
  for select to authenticated using (
    hidden_at is not null and teacher_can_restore
    and public.can_manage_learning_material(uploaded_by,course_id,learning_track)
  );

create or replace function public.set_learning_material_removed(p_material uuid,p_removed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  material public.learning_materials%rowtype;
begin
  if not public.is_teacher() or p_removed is null then
    raise exception 'Approved teaching access and a valid removal decision are required' using errcode='42501';
  end if;
  select * into material from public.learning_materials m where m.id=p_material for update;
  if not found or not coalesce(public.can_manage_learning_material(
    material.uploaded_by,material.course_id,material.learning_track),false) then
    raise exception 'You cannot manage this learning material' using errcode='42501';
  end if;
  if not public.is_admin() and material.hidden_at is not null and not material.teacher_can_restore then
    raise exception 'Only an administrator can restore this material' using errcode='42501';
  end if;
  if (material.hidden_at is not null)=p_removed then return; end if;

  update public.learning_materials
     set hidden_at=case when p_removed then now() else null end,
         teacher_can_restore=p_removed and not public.is_admin()
   where id=material.id;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values ((select auth.uid()),case when p_removed then 'learning_material_removed'
      else 'learning_material_restored' end,'learning_material',material.id);
end;
$$;
revoke all on function public.set_learning_material_removed(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_learning_material_removed(uuid,boolean) to authenticated;

commit;
