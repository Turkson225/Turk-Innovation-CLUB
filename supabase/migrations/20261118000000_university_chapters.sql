-- Additive pilot for university workspaces. Do not reclassify existing club-wide data.
begin;

do $$ begin
  if to_regprocedure('public.space_require_recent_admin_mfa()') is null
     or to_regprocedure('public.space_guard_admin_write()') is null then
    raise exception 'Install the existing SPACE security hardening migration first.';
  end if;
end $$;

create table if not exists public.space_chapters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 48),
  name text not null check (length(btrim(name)) between 3 and 100),
  institution text not null check (length(btrim(institution)) between 2 and 150),
  description text not null default '' check (length(description) <= 2000),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.space_chapter_memberships (
  id uuid not null unique default gen_random_uuid(),
  chapter_id uuid not null references public.space_chapters(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','coordinator','teacher','secretary')),
  status text not null default 'pending' check (status in ('pending','active','declined','inactive')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chapter_id,user_id)
);
create index if not exists space_chapter_memberships_user_idx on public.space_chapter_memberships(user_id,chapter_id);
create index if not exists space_chapter_memberships_roster_idx on public.space_chapter_memberships(chapter_id,status,requested_at desc,id);

create table if not exists public.space_chapter_activities (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.space_chapters(id),
  kind text not null check (kind in ('announcement','event','project','workshop')),
  title text not null check (length(btrim(title)) between 3 and 150),
  body text not null check (length(btrim(body)) between 3 and 4000),
  starts_at timestamptz,
  location text not null default '' check (length(location) <= 200),
  track text check (track in ('Controls and Automation','Software and Programming','Electronics and Robotics','AI & Machine Learning')),
  author_id uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'event' or starts_at is not null),
  check ((kind = 'workshop') = (track is not null))
);
create index if not exists space_chapter_activities_page_idx on public.space_chapter_activities(chapter_id,kind,created_at desc,id desc) where archived_at is null;

-- Only constrained RPCs access these tables. RLS denies direct browser operations
-- even if a default grant is added later. Permission checks always use auth.uid().
do $$ declare v_table text;
begin
  foreach v_table in array array['space_chapters','space_chapter_memberships','space_chapter_activities'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public, anon, authenticated',v_table);
    execute format('drop trigger if exists space_admin_mfa_write on public.%I',v_table);
    execute format('create trigger space_admin_mfa_write before insert or update or delete on public.%I for each statement execute function public.space_guard_admin_write()',v_table);
  end loop;
end $$;

create or replace function space_private.is_chapter_participant()
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_approved()
    and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role <> 'investor');
$$;

create or replace function space_private.chapter_role(p_chapter uuid)
returns text language sql stable security definer set search_path='' as $$
  select m.role from public.space_chapter_memberships m
    where m.chapter_id=p_chapter and m.user_id=(select auth.uid()) and m.status='active'
      and space_private.is_chapter_participant();
$$;

revoke all on function space_private.is_chapter_participant(),space_private.chapter_role(uuid) from public,anon,authenticated;

create or replace function public.space_chapter_directory(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb; v_mine jsonb;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]'::jsonb) into v_rows from (
    select c.id,c.name,c.slug,c.institution,c.description,c.status,m.status as membership_status
    from public.space_chapters c
    left join public.space_chapter_memberships m on m.chapter_id=c.id and m.user_id=(select auth.uid())
    where c.status='active' or (select public.is_admin())
    order by c.name,c.id limit 26 offset greatest(0,coalesce(p_offset,0))
  ) r;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]'::jsonb) into v_mine from (
    select c.id,c.name,c.slug,c.institution,c.status,m.status as membership_status,m.role as chapter_role
    from public.space_chapters c join public.space_chapter_memberships m on m.chapter_id=c.id
    where m.user_id=(select auth.uid()) and (c.status='active' or (c.status='archived' and m.status='active'))
    order by c.name,c.id
  ) r;
  return jsonb_build_object('chapters',v_rows,'mine',v_mine);
end $$;

create or replace function public.space_get_chapter(p_slug text,p_kind text default 'announcement',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_chapter public.space_chapters; v_membership public.space_chapter_memberships;
  v_admin boolean:=public.is_admin(); v_can_read boolean; v_can_manage boolean; v_rows jsonb:='[]'::jsonb;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('announcement','event','project','workshop') then raise exception 'Choose a valid activity type'; end if;
  select * into v_chapter from public.space_chapters where slug=p_slug;
  if v_chapter.id is not null then
    select * into v_membership from public.space_chapter_memberships
      where chapter_id=v_chapter.id and user_id=(select auth.uid());
  end if;
  if v_chapter.id is null or (not v_admin and v_chapter.status<>'active'
      and not (v_chapter.status='archived' and coalesce(v_membership.status='active',false))) then
    raise exception 'Chapter not found or unavailable' using errcode='42501';
  end if;
  v_can_read:=v_admin or coalesce(v_membership.status='active',false);
  v_can_manage:=(v_admin or coalesce(v_membership.status='active' and v_membership.role='coordinator',false)) and v_chapter.status='active';
  if v_can_read then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows from (
      select a.id,a.kind,a.title,a.body,a.starts_at,a.location,a.track,a.created_at,
        (v_can_manage or (v_chapter.status='active' and v_membership.status='active'
          and v_membership.role='teacher' and a.kind='workshop' and a.author_id=(select auth.uid()))) is true as can_edit
      from public.space_chapter_activities a
      where a.chapter_id=v_chapter.id and a.kind=p_kind and a.archived_at is null
      order by a.created_at desc,a.id desc limit 21 offset greatest(0,coalesce(p_offset,0))
    ) r;
  end if;
  return jsonb_build_object('chapter',to_jsonb(v_chapter),'membership_status',v_membership.status,'role',v_membership.role,
    'can_read',v_can_read,'can_manage',v_can_manage,
    'can_publish_workshop',v_can_manage or (v_chapter.status='active' and v_membership.status='active' and v_membership.role='teacher') is true,
    'activities',v_rows);
end $$;

create or replace function public.space_chapter_roster(p_chapter uuid,p_status text default 'pending',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb; v_admin boolean:=public.is_admin();
begin
  if not space_private.is_chapter_participant() or not (v_admin or coalesce(space_private.chapter_role(p_chapter)='coordinator',false)) then
    raise exception 'Chapter leadership access required' using errcode='42501';
  end if;
  if p_status is null or p_status not in ('pending','active','declined','inactive') then raise exception 'Choose a valid membership status'; end if;
  if not exists(select 1 from public.space_chapters c where c.id=p_chapter and (v_admin or c.status='active')) then
    raise exception 'Chapter not found or unavailable' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.requested_at desc,r.id),'[]'::jsonb) into v_rows from (
    select m.id,m.user_id,p.full_name,m.status,m.role,m.requested_at
    from public.space_chapter_memberships m join public.profiles p on p.id=m.user_id
    where m.chapter_id=p_chapter and m.status=p_status and p.membership_status='approved' and p.role<>'investor'
    order by m.requested_at desc,m.id limit 21 offset greatest(0,coalesce(p_offset,0))
  ) r;
  return v_rows;
end $$;

create or replace function public.space_save_chapter(p_chapter uuid,p_slug text,p_name text,p_institution text,p_description text,p_status text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Central administrator access required' using errcode='42501'; end if;
  perform public.space_require_recent_admin_mfa();
  if p_status is null or p_status not in ('draft','active','archived') then raise exception 'Choose a valid chapter status'; end if;
  if p_chapter is null then
    if p_status='archived' then raise exception 'Start a new chapter as a draft or active'; end if;
    insert into public.space_chapters(slug,name,institution,description,status)
      values(lower(btrim(p_slug)),btrim(p_name),btrim(p_institution),btrim(coalesce(p_description,'')),p_status) returning id into v_id;
  else
    -- Keep slug stable so published chapter URLs do not break.
    update public.space_chapters set name=btrim(p_name),institution=btrim(p_institution),description=btrim(coalesce(p_description,'')),status=p_status
      where id=p_chapter and (status='draft' or p_status<>'draft') returning id into v_id;
    if v_id is null then raise exception 'Chapter unavailable. Only a new chapter can be a draft.'; end if;
  end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'chapter_saved_'||p_status,'chapter',v_id);
  return v_id;
end $$;

create or replace function public.space_request_chapter_membership(p_chapter uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_status text; v_id uuid;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found then raise exception 'This chapter is not accepting requests'; end if;
  select status into v_status from public.space_chapter_memberships where chapter_id=p_chapter and user_id=(select auth.uid());
  if found then return v_status; end if;
  perform space_private.consume_quota((select auth.uid()),'chapter-join','',3600,10);
  insert into public.space_chapter_memberships(chapter_id,user_id) values(p_chapter,(select auth.uid())) returning id into v_id;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'chapter_join_requested','chapter_membership',v_id);
  return 'pending';
end $$;

create or replace function public.space_review_chapter_membership(p_chapter uuid,p_user uuid,p_decision text)
returns void language plpgsql security definer set search_path='' as $$
declare v_member public.space_chapter_memberships; v_admin boolean:=public.is_admin(); v_status text;
begin
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found then raise exception 'Chapter unavailable' using errcode='42501'; end if;
  if not space_private.is_chapter_participant() or not (v_admin or coalesce(space_private.chapter_role(p_chapter)='coordinator',false)) then
    raise exception 'Chapter leadership access required' using errcode='42501';
  end if;
  if v_admin then perform public.space_require_recent_admin_mfa(); end if;
  if p_user=(select auth.uid()) then raise exception 'You cannot review your own chapter membership'; end if;
  select m.* into v_member from public.space_chapter_memberships m join public.profiles p on p.id=m.user_id
    where m.chapter_id=p_chapter and m.user_id=p_user and p.membership_status='approved' and p.role<>'investor';
  if v_member.id is null or (not v_admin and v_member.role<>'member') then
    raise exception 'Only central administrators can change chapter staff memberships' using errcode='42501';
  end if;
  v_status:=case
    when v_member.status='pending' and p_decision='approve' then 'active'
    when v_member.status='pending' and p_decision='decline' then 'declined'
    when v_member.status='active' and p_decision='remove' then 'inactive'
    when v_member.status in ('declined','inactive') and p_decision='restore' then 'active'
  end;
  if v_status is null then raise exception 'That decision is not valid for this membership'; end if;
  update public.space_chapter_memberships set status=v_status,updated_at=now() where id=v_member.id;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'chapter_membership_'||v_status,'chapter_membership',v_member.id);
end $$;

create or replace function public.space_assign_chapter_role(p_chapter uuid,p_user uuid,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Central administrator access required' using errcode='42501'; end if;
  perform public.space_require_recent_admin_mfa();
  if p_role is null or p_role not in ('member','coordinator','teacher','secretary') then raise exception 'Invalid chapter role'; end if;
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found then raise exception 'Chapter unavailable'; end if;
  update public.space_chapter_memberships m set role=p_role,updated_at=now() from public.profiles p
    where m.chapter_id=p_chapter and m.user_id=p_user and m.status='active'
      and p.id=m.user_id and p.membership_status='approved' and p.role<>'investor' returning m.id into v_id;
  if v_id is null then raise exception 'Only active chapter members can be assigned a role'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values((select auth.uid()),'chapter_role_'||p_role,'chapter_membership',v_id);
end $$;

create or replace function public.space_save_chapter_activity(p_chapter uuid,p_activity uuid,p_kind text,p_title text,
  p_body text,p_starts_at timestamptz,p_location text,p_track text,p_archive boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_role text; v_admin boolean:=public.is_admin(); v_existing public.space_chapter_activities;
  v_actor uuid:=(select auth.uid());
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found then raise exception 'Chapter unavailable' using errcode='42501'; end if;
  v_role:=space_private.chapter_role(p_chapter);
  if not (v_admin or coalesce(v_role in ('coordinator','teacher'),false)) then
    raise exception 'Chapter publishing access required' using errcode='42501';
  end if;
  if p_activity is not null then
    select * into v_existing from public.space_chapter_activities
      where id=p_activity and chapter_id=p_chapter and archived_at is null;
    if v_existing.id is null then raise exception 'Activity unavailable'; end if;
    p_kind:=v_existing.kind;
  end if;
  if not (v_admin or coalesce(v_role='coordinator',false)
      or (v_role='teacher' and p_kind='workshop' and (p_activity is null or v_existing.author_id=v_actor)) is true) then
    raise exception 'Teachers can only manage their own chapter workshops' using errcode='42501';
  end if;
  if p_archive is true then
    if p_activity is null then raise exception 'Choose an activity to archive'; end if;
    update public.space_chapter_activities set archived_at=now(),updated_at=now() where id=p_activity;
    return p_activity;
  end if;
  if p_kind is null or p_kind not in ('announcement','event','project','workshop') then raise exception 'Choose a valid activity type'; end if;
  if p_kind='event' and p_starts_at is null then raise exception 'Events need a start date and time'; end if;
  if p_kind='workshop' and (p_track is null or p_track not in ('Controls and Automation','Software and Programming','Electronics and Robotics','AI & Machine Learning')) then
    raise exception 'Choose a workshop learning track';
  end if;
  if p_kind<>'workshop' then p_track:=null; end if;
  if p_kind not in ('event','workshop') then p_starts_at:=null; end if;
  if p_activity is null then
    perform space_private.consume_quota(v_actor,'chapter-publish','',3600,40);
    insert into public.space_chapter_activities(chapter_id,kind,title,body,starts_at,location,track,author_id)
      values(p_chapter,p_kind,btrim(p_title),btrim(p_body),p_starts_at,btrim(coalesce(p_location,'')),p_track,v_actor) returning id into v_id;
  else
    update public.space_chapter_activities set title=btrim(p_title),body=btrim(p_body),starts_at=p_starts_at,
      location=btrim(coalesce(p_location,'')),track=p_track,updated_at=now() where id=p_activity returning id into v_id;
  end if;
  return v_id;
end $$;

revoke all on function
  public.space_chapter_directory(integer),
  public.space_get_chapter(text,text,integer),
  public.space_chapter_roster(uuid,text,integer),
  public.space_save_chapter(uuid,text,text,text,text,text),
  public.space_request_chapter_membership(uuid),
  public.space_review_chapter_membership(uuid,uuid,text),
  public.space_assign_chapter_role(uuid,uuid,text),
  public.space_save_chapter_activity(uuid,uuid,text,text,text,timestamptz,text,text,boolean)
from public,anon,authenticated;
grant execute on function
  public.space_chapter_directory(integer),
  public.space_get_chapter(text,text,integer),
  public.space_chapter_roster(uuid,text,integer),
  public.space_save_chapter(uuid,text,text,text,text,text),
  public.space_request_chapter_membership(uuid),
  public.space_review_chapter_membership(uuid,uuid,text),
  public.space_assign_chapter_role(uuid,uuid,text),
  public.space_save_chapter_activity(uuid,uuid,text,text,text,timestamptz,text,text,boolean)
to authenticated;

commit;
