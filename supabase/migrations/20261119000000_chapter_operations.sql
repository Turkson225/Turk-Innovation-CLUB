-- Add a central chapter desk and local offices without changing the chapter pilot data.
begin;

do $$ begin
  if to_regclass('public.space_chapter_memberships') is null
     or to_regprocedure('space_private.chapter_role(uuid)') is null then
    raise exception 'Apply the university chapters migration before chapter operations.';
  end if;
end $$;

create table if not exists public.space_chapter_office_assignments (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.space_chapters(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  office text not null check (office in ('deputy_coordinator','secretary','treasurer','teaching_lead','events_lead','projects_lead','communications')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists chapter_office_current_idx
  on public.space_chapter_office_assignments(chapter_id,user_id,office) where revoked_at is null;
create index if not exists chapter_office_user_idx
  on public.space_chapter_office_assignments(user_id,chapter_id) where revoked_at is null;

create table if not exists public.space_chapter_office_tasks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.space_chapters(id),
  office text not null check (office in ('coordinator','teacher','deputy_coordinator','secretary','treasurer','teaching_lead','events_lead','projects_lead','communications')),
  assignee_id uuid references public.profiles(id) on delete set null,
  title text not null check (length(btrim(title)) between 3 and 150),
  instructions text not null check (length(btrim(instructions)) between 3 and 4000),
  due_on date,
  status text not null check (status in ('open','submitted','completed','cancelled')) default 'open',
  progress_note text not null default '' check (length(progress_note) <= 3000),
  review_note text not null default '' check (length(review_note) <= 3000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists chapter_office_tasks_queue_idx
  on public.space_chapter_office_tasks(chapter_id,status,updated_at desc,id desc);
create index if not exists chapter_office_tasks_person_idx
  on public.space_chapter_office_tasks(chapter_id,assignee_id,office,updated_at desc);
create index if not exists chapter_activities_ops_idx
  on public.space_chapter_activities(chapter_id,created_at) where archived_at is null;

create table if not exists public.space_chapter_office_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.space_chapter_office_tasks(id) on delete cascade,
  action text not null check (action in ('create','submit','return','complete','cancel')),
  note text not null default '' check(length(note)<=3000),
  actor_id uuid references public.profiles(id) on delete set null,
  happened_at timestamptz not null default now()
);
create index if not exists chapter_office_task_history_idx on public.space_chapter_office_task_history(task_id,happened_at desc,id);

do $$ declare t text;
begin
  foreach t in array array['space_chapter_office_assignments','space_chapter_office_tasks','space_chapter_office_task_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('drop trigger if exists space_admin_mfa_write on public.%I',t);
    execute format('create trigger space_admin_mfa_write before insert or update or delete on public.%I for each statement execute function public.space_guard_admin_write()',t);
  end loop;
end $$;

-- Coordinators can review ordinary members, but an appointed officer's access
-- requires the central administrator just like a pilot-era chapter staff role.
create or replace function space_private.protect_chapter_office_membership()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and (select auth.uid()) is not null
    and not public.is_admin() and exists(select 1 from public.space_chapter_office_assignments a
      where a.chapter_id=old.chapter_id and a.user_id=old.user_id and a.revoked_at is null) then
    raise exception 'Only central administrators can change chapter staff memberships' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function space_private.protect_chapter_office_membership() from public,anon,authenticated;
drop trigger if exists protect_chapter_office_membership on public.space_chapter_memberships;
create trigger protect_chapter_office_membership before update of status on public.space_chapter_memberships
  for each row execute function space_private.protect_chapter_office_membership();

create or replace function space_private.notify_chapter_membership_role()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role is distinct from old.role and public.is_admin() then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(new.user_id,'chapter_office','Chapter role updated','chapter_office',new.chapter_id);
  end if;
  return new;
end $$;
revoke all on function space_private.notify_chapter_membership_role() from public,anon,authenticated;
drop trigger if exists notify_chapter_membership_role on public.space_chapter_memberships;
create trigger notify_chapter_membership_role after update of role on public.space_chapter_memberships
  for each row execute function space_private.notify_chapter_membership_role();

-- Legacy chapter leaders/teachers/secretaries get their offices automatically.
-- Effective access disappears if that person loses club or chapter membership.
create or replace function space_private.chapter_office_holders(p_chapter uuid)
returns table(user_id uuid,office text) language sql stable security definer set search_path='' as $$
  select m.user_id,m.role from public.space_chapter_memberships m
    join public.profiles p on p.id=m.user_id
    where m.chapter_id=p_chapter and m.status='active' and m.role in ('coordinator','teacher','secretary')
      and p.membership_status='approved' and p.role<>'investor'
  union
  select a.user_id,a.office from public.space_chapter_office_assignments a
    join public.space_chapter_memberships m on m.chapter_id=a.chapter_id and m.user_id=a.user_id and m.status='active'
    join public.profiles p on p.id=a.user_id
    where a.chapter_id=p_chapter and a.revoked_at is null and p.membership_status='approved' and p.role<>'investor'
$$;
revoke all on function space_private.chapter_office_holders(uuid) from public,anon,authenticated;

create or replace function space_private.chapter_ops_counts(p_chapter uuid,p_days integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'active',m.active,'pending',m.pending,'new_requests',m.new_requests,
    'announcements',a.announcements,'events',a.events,'projects',a.projects,'workshops',a.workshops,
    'open',t.open,'submitted',t.submitted,'completed',t.completed,'overdue',t.overdue,'needs_reassignment',t.needs_reassignment)
  from (
    select count(*) filter(where m.status='active') active,count(*) filter(where m.status='pending') pending,
      count(*) filter(where m.requested_at>=now()-make_interval(days=>p_days)) new_requests
    from public.space_chapter_memberships m join public.profiles p on p.id=m.user_id
    where (p_chapter is null or m.chapter_id=p_chapter) and p.membership_status='approved' and p.role<>'investor'
  ) m cross join (
    select count(*) filter(where kind='announcement') announcements,count(*) filter(where kind='event') events,
      count(*) filter(where kind='project') projects,count(*) filter(where kind='workshop') workshops
    from public.space_chapter_activities
    where (p_chapter is null or chapter_id=p_chapter) and archived_at is null and created_at>=now()-make_interval(days=>p_days)
  ) a cross join (
    select count(*) filter(where t.status='open') open,count(*) filter(where t.status='submitted') submitted,
      count(*) filter(where t.status='completed' and t.completed_at>=now()-make_interval(days=>p_days)) completed,
      count(*) filter(where t.status in ('open','submitted') and t.due_on<(now() at time zone 'UTC')::date) overdue,
      count(*) filter(where t.status='open' and not exists(
        select 1 from public.space_chapter_memberships m join public.profiles p on p.id=m.user_id
        where m.chapter_id=t.chapter_id and m.user_id=t.assignee_id and m.status='active'
          and p.membership_status='approved' and p.role<>'investor'
          and (m.role=t.office or exists(select 1 from public.space_chapter_office_assignments aa
            where aa.chapter_id=t.chapter_id and aa.user_id=t.assignee_id and aa.office=t.office and aa.revoked_at is null))
      )) needs_reassignment
    from public.space_chapter_office_tasks t where p_chapter is null or t.chapter_id=p_chapter
  ) t
$$;
revoke all on function space_private.chapter_ops_counts(uuid,integer) from public,anon,authenticated;

create or replace function public.space_chapter_ops_index(p_days integer default 30,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb; v_total integer; v_open integer;
begin
  if not public.is_admin() then raise exception 'Central administrator access required' using errcode='42501'; end if;
  if p_days is null or p_days not in (30,90) then raise exception 'Choose 30 or 90 days'; end if;
  select count(*),count(*) filter(where status='active') into v_total,v_open from public.space_chapters;
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('metrics',space_private.chapter_ops_counts(c.id,p_days),
    'has_coordinator',exists(select 1 from space_private.chapter_office_holders(c.id) h where h.office='coordinator'))
    order by c.name,c.id),'[]'::jsonb) into v_rows from (
    select id,name,institution,slug,status from public.space_chapters
    order by name,id limit 20 offset greatest(coalesce(p_offset,0),0)
  ) c;
  return jsonb_build_object('rows',v_rows,'total',v_total,'open_chapters',v_open,
    'metrics',space_private.chapter_ops_counts(null,p_days));
end $$;

create or replace function public.space_my_chapter_offices()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]'::jsonb) into v_rows from (
    select c.id,c.name,c.institution,c.slug,(
      select coalesce(jsonb_agg(h.office order by h.office),'[]'::jsonb)
      from space_private.chapter_office_holders(c.id) h where h.user_id=(select auth.uid())
    ) offices
    from public.space_chapter_memberships m join public.space_chapters c on c.id=m.chapter_id
    where m.user_id=(select auth.uid()) and m.status='active' and c.status='active'
  ) r where r.offices<>'[]'::jsonb;
  return v_rows;
end $$;

create or replace function public.space_chapter_ops_detail(p_chapter uuid,p_days integer default 30,
  p_office text default null,p_status text default 'all',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.space_chapters; v_admin boolean:=public.is_admin(); v_manage boolean;
  v_me uuid:=(select auth.uid()); v_mine text[]; v_tasks jsonb; v_rows jsonb;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  if p_days is null or p_days not in (30,90) then raise exception 'Choose 30 or 90 days'; end if;
  if p_status is null or p_status not in ('all','open','submitted','completed','cancelled') then raise exception 'Choose a valid task status'; end if;
  select * into c from public.space_chapters where id=p_chapter;
  select coalesce(array_agg(h.office),array[]::text[]) into v_mine
    from space_private.chapter_office_holders(p_chapter) h where h.user_id=v_me;
  if c.id is null or (not v_admin and (c.status<>'active' or cardinality(v_mine)=0)) then
    raise exception 'Chapter office access required' using errcode='42501';
  end if;
  v_manage:=v_admin or 'coordinator'=any(v_mine);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.office),'[]'::jsonb) into v_rows from (
    with slots(office) as (values ('coordinator'),('teacher'),('deputy_coordinator'),('secretary'),('treasurer'),
       ('teaching_lead'),('events_lead'),('projects_lead'),('communications')),
    holders as (select h.office,count(*) total from space_private.chapter_office_holders(p_chapter) h group by h.office),
    work as (
      select t.office,count(*) filter(where t.status='open') open,count(*) filter(where t.status='submitted') submitted,
        count(*) filter(where t.status='completed' and t.completed_at>=now()-make_interval(days=>p_days)) completed,
        count(*) filter(where t.status in ('open','submitted') and t.due_on<(now() at time zone 'UTC')::date) overdue
      from public.space_chapter_office_tasks t
      where t.chapter_id=p_chapter and (v_manage or (t.assignee_id=v_me and t.office=any(v_mine)))
      group by t.office
    )
    select s.office,case when v_manage then coalesce(h.total,0) else null end holders,
      coalesce(w.open,0) open,coalesce(w.submitted,0) submitted,coalesce(w.completed,0) completed,coalesce(w.overdue,0) overdue
    from slots s left join work w on w.office=s.office left join holders h on h.office=s.office
    where v_manage or s.office=any(v_mine)
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc,r.id desc),'[]'::jsonb) into v_tasks from (
    select t.id,t.office,t.assignee_id,p.full_name assignee_name,t.title,t.instructions,t.due_on,t.status,
      t.progress_note,t.review_note,t.updated_at,
      exists(select 1 from space_private.chapter_office_holders(p_chapter) h
        where h.user_id=t.assignee_id and h.office=t.office) assignee_has_office
    from public.space_chapter_office_tasks t left join public.profiles p on p.id=t.assignee_id
    where t.chapter_id=p_chapter and (v_manage or (t.assignee_id=v_me and t.office=any(v_mine)))
      and (p_office is null or t.office=p_office) and (p_status='all' or t.status=p_status)
    order by t.updated_at desc,t.id desc limit 21 offset greatest(coalesce(p_offset,0),0)
  ) r;

  return jsonb_build_object('chapter',jsonb_build_object('id',c.id,'name',c.name,'institution',c.institution,'slug',c.slug,'status',c.status),
    'manager',v_manage,'admin',v_admin,'my_offices',to_jsonb(v_mine),'office_metrics',v_rows,'tasks',v_tasks,
    'metrics',case when v_manage then space_private.chapter_ops_counts(p_chapter,p_days) else null end);
end $$;

create or replace function public.space_chapter_ops_people(p_chapter uuid,p_query text default '',p_offset integer default 0,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb; v_admin boolean:=public.is_admin(); v_query text:=left(btrim(coalesce(p_query,'')),100);
begin
  if not space_private.is_chapter_participant() or not (v_admin or coalesce(space_private.chapter_role(p_chapter)='coordinator',false)) then
    raise exception 'Chapter leadership access required' using errcode='42501';
  end if;
  if not exists(select 1 from public.space_chapters c where c.id=p_chapter and (v_admin or c.status='active')) then
    raise exception 'Chapter unavailable' using errcode='42501';
  end if;
  if p_days is null or p_days not in (30,90) then raise exception 'Choose 30 or 90 days'; end if;
  with holders as (select h.user_id,jsonb_agg(h.office order by h.office) offices from space_private.chapter_office_holders(p_chapter) h group by h.user_id)
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('work',to_jsonb(w)) order by r.full_name,r.user_id),'[]'::jsonb) into v_rows from (
    select m.user_id,p.full_name,m.role,coalesce(h.offices,'[]'::jsonb) offices,
      coalesce((select jsonb_agg(a.office order by a.office) from public.space_chapter_office_assignments a
        where a.chapter_id=p_chapter and a.user_id=m.user_id and a.revoked_at is null),'[]'::jsonb) assigned_offices
    from public.space_chapter_memberships m join public.profiles p on p.id=m.user_id left join holders h on h.user_id=m.user_id
    where m.chapter_id=p_chapter and m.status='active' and p.membership_status='approved' and p.role<>'investor'
      and (v_query='' or strpos(lower(p.full_name),lower(v_query))>0)
    order by p.full_name,m.user_id limit 21 offset greatest(coalesce(p_offset,0),0)
  ) r cross join lateral (
    select count(*) filter(where t.status='open') open,count(*) filter(where t.status='submitted') submitted,
      count(*) filter(where t.status='completed' and t.completed_at>=now()-make_interval(days=>p_days)) completed,
      count(*) filter(where t.status in ('open','submitted') and t.due_on<(now() at time zone 'UTC')::date) overdue
    from public.space_chapter_office_tasks t where t.chapter_id=p_chapter and t.assignee_id=r.user_id
  ) w;
  return v_rows;
end $$;

create or replace function public.space_set_chapter_office(p_chapter uuid,p_user uuid,p_office text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_actor uuid:=(select auth.uid());
begin
  if not public.is_admin() then raise exception 'Central administrator access required' using errcode='42501'; end if;
  perform public.space_require_recent_admin_mfa();
  if p_enabled is null or p_office is null or p_office not in ('deputy_coordinator','secretary','treasurer','teaching_lead','events_lead','projects_lead','communications') then
    raise exception 'Choose a valid chapter office';
  end if;
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found then raise exception 'Chapter unavailable'; end if;
  if p_enabled then
    if not exists(select 1 from public.space_chapter_memberships m join public.profiles p on p.id=m.user_id
      where m.chapter_id=p_chapter and m.user_id=p_user and m.status='active' and p.membership_status='approved' and p.role<>'investor') then
      raise exception 'Only approved active chapter members can receive a chapter office';
    end if;
    insert into public.space_chapter_office_assignments(chapter_id,user_id,office,assigned_by)
      values(p_chapter,p_user,p_office,v_actor)
      on conflict(chapter_id,user_id,office) where revoked_at is null do nothing returning id into v_id;
  else
    update public.space_chapter_office_assignments set revoked_at=now(),revoked_by=v_actor
      where chapter_id=p_chapter and user_id=p_user and office=p_office and revoked_at is null returning id into v_id;
  end if;
  if v_id is not null then
    insert into public.audit_events(actor_id,action,target_type,target_id)
      values(v_actor,case when p_enabled then 'chapter_office_assigned' else 'chapter_office_revoked' end,'chapter_office_assignment',v_id);
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(p_user,'chapter_office',case when p_enabled then 'New chapter office assigned' else 'Chapter office access updated' end,'chapter_office',p_chapter);
  end if;
end $$;

create or replace function public.space_create_chapter_office_task(p_chapter uuid,p_user uuid,p_office text,
  p_title text,p_instructions text,p_due_on date,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_existing public.space_chapter_office_tasks; v_id uuid;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found or not (public.is_admin() or coalesce(space_private.chapter_role(p_chapter)='coordinator',false)) then
    raise exception 'Chapter leadership access required' using errcode='42501';
  end if;
  if p_request_id is null then raise exception 'A request ID is required'; end if;
  select * into v_existing from public.space_chapter_office_tasks where id=p_request_id and chapter_id=p_chapter and created_by=v_actor;
  if v_existing.id is not null then return v_existing.id; end if;
  if not exists(select 1 from space_private.chapter_office_holders(p_chapter) h where h.user_id=p_user and h.office=p_office) then
    raise exception 'Choose an active holder of this chapter office';
  end if;
  perform space_private.consume_quota(v_actor,'chapter-office-task','',3600,30);
  insert into public.space_chapter_office_tasks(id,chapter_id,office,assignee_id,title,instructions,due_on,created_by)
    values(p_request_id,p_chapter,p_office,p_user,btrim(p_title),btrim(p_instructions),p_due_on,v_actor) returning id into v_id;
  insert into public.space_chapter_office_task_history(task_id,action,actor_id) values(v_id,'create',v_actor);
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values(p_user,'chapter_office','New chapter office task','chapter_office',p_chapter);
  return v_id;
end $$;

create or replace function public.space_chapter_office_task_action(p_chapter uuid,p_task uuid,p_action text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.space_chapter_office_tasks; v_me uuid:=(select auth.uid());
  v_manage boolean; v_note text:=btrim(coalesce(p_note,''));
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  perform 1 from public.space_chapters where id=p_chapter and status='active' for update;
  if not found then raise exception 'Chapter unavailable' using errcode='42501'; end if;
  select * into t from public.space_chapter_office_tasks where id=p_task and chapter_id=p_chapter;
  if t.id is null then raise exception 'Task unavailable' using errcode='42501'; end if;
  v_manage:=public.is_admin() or coalesce(space_private.chapter_role(p_chapter)='coordinator',false);
  if p_action='submit' then
    if t.assignee_id is distinct from v_me or not exists(select 1 from space_private.chapter_office_holders(p_chapter) h
        where h.user_id=v_me and h.office=t.office) then
      raise exception 'Only the assigned officer can submit this task' using errcode='42501';
    end if;
    if t.status<>'open' or length(v_note) not between 3 and 3000 then raise exception 'Submit an open task with a progress note'; end if;
    update public.space_chapter_office_tasks set status='submitted',progress_note=v_note,updated_at=now() where id=t.id;
  elsif p_action in ('return','complete','cancel') then
    if not v_manage then raise exception 'Chapter leadership access required' using errcode='42501'; end if;
    if p_action<>'cancel' and t.assignee_id=v_me then raise exception 'Another chapter leader must review your own work'; end if;
    if p_action='cancel' then
      if t.status not in ('open','submitted') or length(v_note) not between 3 and 3000 then raise exception 'Provide a reason to cancel an unfinished task'; end if;
      update public.space_chapter_office_tasks set status='cancelled',review_note=v_note,updated_at=now() where id=t.id;
    else
      if t.status<>'submitted' then raise exception 'Only submitted work can be reviewed'; end if;
      if length(v_note)>3000 or (p_action='return' and length(v_note)<3) then raise exception 'Provide a review note for requested changes'; end if;
      update public.space_chapter_office_tasks set status=case when p_action='complete' then 'completed' else 'open' end,
        review_note=v_note,completed_at=case when p_action='complete' then now() else null end,updated_at=now() where id=t.id;
    end if;
    if t.assignee_id is not null and t.assignee_id<>v_me and exists(select 1 from space_private.chapter_office_holders(p_chapter) h where h.user_id=t.assignee_id and h.office=t.office) then
      insert into public.notifications(user_id,kind,title,target_type,target_id)
        values(t.assignee_id,'chapter_office','Chapter office task updated','chapter_office',p_chapter);
    end if;
  else
    raise exception 'Choose a valid task action';
  end if;
  insert into public.space_chapter_office_task_history(task_id,action,note,actor_id) values(t.id,p_action,v_note,v_me);
end $$;

create or replace function public.space_chapter_office_task_history(p_chapter uuid,p_task uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.space_chapter_office_tasks; v_me uuid:=(select auth.uid()); v_admin boolean:=public.is_admin();
  v_rows jsonb;
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club membership required' using errcode='42501'; end if;
  select * into t from public.space_chapter_office_tasks where id=p_task and chapter_id=p_chapter;
  if t.id is null or not exists(select 1 from public.space_chapters c where c.id=p_chapter and (v_admin or c.status='active'))
    or not (v_admin or coalesce(space_private.chapter_role(p_chapter)='coordinator',false)
      or (t.assignee_id=v_me and exists(select 1 from space_private.chapter_office_holders(p_chapter) h
        where h.user_id=v_me and h.office=t.office)) is true) then
    raise exception 'Chapter task not found or unavailable' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.happened_at desc,r.id),'[]'::jsonb) into v_rows from (
    select h.id,h.action,h.note,h.happened_at from public.space_chapter_office_task_history h
      where h.task_id=t.id order by h.happened_at desc,h.id limit 30
  ) r;
  return v_rows;
end $$;

revoke all on function public.space_chapter_ops_index(integer,integer),public.space_my_chapter_offices(),
  public.space_chapter_ops_detail(uuid,integer,text,text,integer),public.space_chapter_ops_people(uuid,text,integer,integer),
  public.space_set_chapter_office(uuid,uuid,text,boolean),public.space_create_chapter_office_task(uuid,uuid,text,text,text,date,uuid),
  public.space_chapter_office_task_action(uuid,uuid,text,text),public.space_chapter_office_task_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.space_chapter_ops_index(integer,integer),public.space_my_chapter_offices(),
  public.space_chapter_ops_detail(uuid,integer,text,text,integer),public.space_chapter_ops_people(uuid,text,integer,integer),
  public.space_set_chapter_office(uuid,uuid,text,boolean),public.space_create_chapter_office_task(uuid,uuid,text,text,text,date,uuid),
  public.space_chapter_office_task_action(uuid,uuid,text,text),public.space_chapter_office_task_history(uuid,uuid) to authenticated;

commit;
