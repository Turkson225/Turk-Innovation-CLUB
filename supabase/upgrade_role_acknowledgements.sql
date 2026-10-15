-- Run after upgrade_learning_dashboards.sql and upgrade_officer_workspaces_finance.sql.
-- Acknowledgement records receipt. Only administrator assignments grant access.
begin;
do $$ begin
 if to_regprocedure('public.assign_account_role(uuid,text,text[])') is null
  or to_regprocedure('public.set_club_officer_roles(uuid,text[],text)') is null then
  raise exception 'Run learning dashboards and officer workspaces migrations first';
 end if;
end $$;
create table if not exists public.space_role_notices(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 assigned_by uuid references public.profiles(id),assigned_name text not null,
 title text not null,note text not null check(length(note) between 3 and 2000),snapshot jsonb not null,
 created_at timestamptz not null default now(),acknowledged_at timestamptz
);
create index if not exists space_role_notice_owner on public.space_role_notices(user_id,created_at desc,id);
alter table public.space_role_notices enable row level security;
revoke all on public.space_role_notices from public,anon,authenticated;
grant select on public.space_role_notices to authenticated;
drop policy if exists role_notice_read on public.space_role_notices;
create policy role_notice_read on public.space_role_notices for select to authenticated
 using(user_id=(select auth.uid()) or (select public.is_admin()));

create or replace function public.space_capture_role_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_profile public.profiles%rowtype;v_note text;v_roles text[];v_tracks text[];v_name text;
begin
 if not (new.kind='role' and new.target_type='officer'
  or new.kind='membership' and new.title like 'Your account role is now %') then return new;end if;
 if not public.is_admin() then return new;end if;
 select * into v_profile from public.profiles where id=new.user_id;
 if not found then return new;end if;
 select coalesce(array_agg(position order by position),array[]::text[]) into v_roles
  from public.officer_assignments where user_id=new.user_id and revoked_at is null;
 select coalesce(array_agg(track order by track),array[]::text[]) into v_tracks
  from public.teaching_track_assignments where teacher_id=new.user_id;
 v_note:=nullif(trim(current_setting('space.assignment_note',true)),'');
 if v_note is null and new.target_type='officer' then
  select note into v_note from public.officer_assignments where user_id=new.user_id
   order by greatest(created_at,coalesce(revoked_at,created_at)) desc,id desc limit 1;
 end if;
 v_note:=coalesce(nullif(trim(v_note),''),'Your administrator updated your responsibilities. Review your current access and acknowledge this notice.');
 select full_name into v_name from public.profiles where id=auth.uid();
 insert into public.space_role_notices(user_id,assigned_by,assigned_name,title,note,snapshot)
 values(new.user_id,auth.uid(),coalesce(v_name,'Club administrator'),
  case when new.target_type='officer' then 'Club officer responsibilities updated' else 'Your account role: '||initcap(v_profile.role) end,
  v_note,jsonb_build_object('change_type',case when new.target_type='officer' then 'officer' else 'account' end,'role',v_profile.role,'teaching_enabled',v_profile.founder_teaching_enabled,
   'teaching_tracks',v_tracks,'officer_roles',v_roles)) returning id into v_id;
 new.kind:='role_assignment';new.target_type:='role_change';new.target_id:=v_id;
 new.title:=case when cardinality(v_roles)>0 and v_profile.role='member' then 'Your club responsibilities have changed' else 'Your SPACE role has been updated' end;
 return new;
end $$;
revoke all on function public.space_capture_role_notification() from public,anon,authenticated;
drop trigger if exists space_role_notification on public.notifications;
create trigger space_role_notification before insert on public.notifications for each row execute function public.space_capture_role_notification();

create or replace function public.space_assign_account_role(p_user uuid,p_role text,p_tracks text[],p_note text) returns void
language plpgsql security definer set search_path='' as $$ declare v_previous text;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_note is null or length(trim(p_note)) not between 3 and 1000 then raise exception 'Add an assignment note of 3 to 1000 characters';end if;
 v_previous:=current_setting('space.assignment_note',true);
 perform set_config('space.assignment_note',trim(p_note),true);
 perform public.assign_account_role(p_user,p_role,p_tracks);
 perform set_config('space.assignment_note',coalesce(v_previous,''),true);
end $$;
create or replace function public.space_set_officer_roles(p_user uuid,p_roles text[],p_note text) returns void
language plpgsql security definer set search_path='' as $$ declare v_previous text;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 v_previous:=current_setting('space.assignment_note',true);perform set_config('space.assignment_note',trim(coalesce(p_note,'')),true);
 perform public.set_club_officer_roles(p_user,p_roles,p_note);
 perform set_config('space.assignment_note',coalesce(v_previous,''),true);
end $$;
create or replace function public.space_acknowledge_role(p_notice uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.profiles where id=auth.uid() and membership_status='approved') then raise exception 'Approved account required';end if;
 update public.space_role_notices set acknowledged_at=coalesce(acknowledged_at,now()) where id=p_notice and user_id=auth.uid();
 if not found then raise exception 'Role notice unavailable';end if;
 update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and target_type='role_change' and target_id=p_notice;
end $$;
create or replace function public.space_role_updates(p_offset integer default 0,p_limit integer default 20,p_admin boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare v_result jsonb;begin
 if not exists(select 1 from public.profiles where id=auth.uid() and membership_status='approved') then raise exception 'Approved account required';end if;
 if p_admin is null or p_admin and not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid page';end if;
 select jsonb_build_object('total',count(*),'pending',count(*) filter(where acknowledged_at is null),'rows',
  coalesce((select jsonb_agg(to_jsonb(x)) from(select n.*,p.full_name member_name from public.space_role_notices n join public.profiles p on p.id=n.user_id
    where p_admin or n.user_id=auth.uid() order by n.created_at desc,n.id desc limit p_limit offset p_offset)x),'[]'::jsonb))
 into v_result from public.space_role_notices where p_admin or user_id=auth.uid();
 return v_result;
end $$;
revoke all on function public.space_assign_account_role(uuid,text,text[],text),public.space_set_officer_roles(uuid,text[],text),public.space_acknowledge_role(uuid),public.space_role_updates(integer,integer,boolean) from public,anon;
grant execute on function public.space_assign_account_role(uuid,text,text[],text),public.space_set_officer_roles(uuid,text[],text),public.space_acknowledge_role(uuid),public.space_role_updates(integer,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
