-- SPACE Map + original illustrated avatars. Run the ENTIRE file in SQL Editor.
-- Additive and rerunnable. No change to existing profiles/media/message permissions.
begin;
create or replace function public.space_map_member(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.id=p_user
  and p.membership_status='approved' and p.role in ('member','teacher','founder','admin'));
$$;
revoke all on function public.space_map_member(uuid) from public,anon,authenticated;

create or replace function public.space_avatar_default()
returns jsonb language sql immutable set search_path = '' as $$
 select '{"v":1,"skin":3,"hair":2,"hairColor":0,"eyes":0,"mouth":0,"beard":0,"glasses":0,"hat":0,"top":0,"topColor":0,"bottom":0,"bottomColor":0,"shoes":0,"shoeColor":0,"accessory":0,"pose":0,"backdrop":0}'::jsonb;
$$;
create or replace function public.space_avatar_valid(p_settings jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; limits jsonb := '{"v":1,"skin":7,"hair":11,"hairColor":7,"eyes":3,"mouth":3,"beard":3,"glasses":3,"hat":5,"top":11,"topColor":11,"bottom":4,"bottomColor":11,"shoes":4,"shoeColor":11,"accessory":5,"pose":3,"backdrop":7}'::jsonb;
begin
 if p_settings is null or jsonb_typeof(p_settings)<>'object' then return false; end if;
 if p_settings->>'v' <> '1' or (select count(*) from jsonb_object_keys(p_settings)) <> 18 then return false; end if;
 for k,v in select * from jsonb_each(p_settings) loop
  if not (limits ? k) or jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]{1,2}$' then return false; end if;
  if v::text::integer < 0 or v::text::integer > (limits->>k)::integer then return false; end if;
 end loop;
 return true;
end;
$$;
create table if not exists public.space_avatar_profiles(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 settings jsonb not null default public.space_avatar_default() check(public.space_avatar_valid(settings)),
 use_on_profile boolean not null default false, use_on_id boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.space_avatar_looks(
 user_id uuid not null references public.profiles(id) on delete cascade,
 slot integer not null check(slot between 1 and 8),label text not null check(length(btrim(label)) between 1 and 40),
 settings jsonb not null check(public.space_avatar_valid(settings)),updated_at timestamptz not null default now(),primary key(user_id,slot)
);
create table if not exists public.space_location_shares(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 share_id uuid not null default gen_random_uuid(), latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),accuracy double precision not null check(accuracy between 0 and 50000),
 precision_mode text not null check(precision_mode in ('approximate','precise')),
 started_at timestamptz not null default now(),updated_at timestamptz not null default now(),expires_at timestamptz not null
);
create table if not exists public.space_location_recipients(
 owner_id uuid not null references public.space_location_shares(user_id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 primary key(owner_id,recipient_id),check(owner_id<>recipient_id)
);
create index if not exists space_location_recipients_recipient on public.space_location_recipients(recipient_id,owner_id);
create index if not exists space_location_shares_expiry on public.space_location_shares(expires_at);
create table if not exists public.space_map_places(
 id uuid primary key default gen_random_uuid(),title text not null check(length(btrim(title)) between 1 and 120),
 kind text not null check(kind in ('workshop','event','meetup')),description text not null default '' check(length(description)<=500),
 latitude double precision not null check(latitude between -90 and 90),longitude double precision not null check(longitude between -180 and 180),
 starts_at timestamptz,created_by uuid references public.profiles(id) on delete set null,updated_at timestamptz not null default now()
);
-- Raw coordinates and recipient lists are never selectable, including by admins.
-- Definer RPCs below provide narrowly authorized rows; do not add these tables to Realtime.
alter table public.space_avatar_profiles enable row level security;
alter table public.space_avatar_looks enable row level security;
alter table public.space_location_shares enable row level security;
alter table public.space_location_recipients enable row level security;
alter table public.space_map_places enable row level security;
revoke all on public.space_avatar_profiles,public.space_avatar_looks,public.space_location_shares,public.space_location_recipients,public.space_map_places from public,anon,authenticated;

create or replace function public.space_avatar_self()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 return jsonb_build_object('avatar',coalesce((select jsonb_build_object('settings',a.settings,'use_on_profile',a.use_on_profile,'use_on_id',a.use_on_id) from public.space_avatar_profiles a where a.user_id=auth.uid()),jsonb_build_object('settings',public.space_avatar_default(),'use_on_profile',false,'use_on_id',false)),
 'looks',coalesce((select jsonb_agg(jsonb_build_object('slot',l.slot,'label',l.label,'settings',l.settings) order by l.slot) from public.space_avatar_looks l where l.user_id=auth.uid()),'[]'::jsonb));
end;
$$;
create or replace function public.space_avatar_save(p_settings jsonb,p_profile boolean,p_id boolean,p_slot integer default null,p_label text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 if not public.space_avatar_valid(p_settings) or p_profile is null or p_id is null then raise exception 'Invalid avatar choices'; end if;
 if p_slot is null then
  insert into public.space_avatar_profiles(user_id,settings,use_on_profile,use_on_id) values(auth.uid(),p_settings,p_profile,p_id)
  on conflict(user_id) do update set settings=excluded.settings,use_on_profile=excluded.use_on_profile,use_on_id=excluded.use_on_id,updated_at=now();
 else
  if p_slot not between 1 and 8 or p_label is null or length(btrim(p_label)) not between 1 and 40 then raise exception 'Choose one of eight look slots and a short name'; end if;
  insert into public.space_avatar_looks(user_id,slot,label,settings) values(auth.uid(),p_slot,btrim(p_label),p_settings)
  on conflict(user_id,slot) do update set label=excluded.label,settings=excluded.settings,updated_at=now();
 end if;
 return public.space_avatar_self();
end;
$$;
create or replace function public.space_avatar_delete_look(p_slot integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 delete from public.space_avatar_looks where user_id=auth.uid() and slot=p_slot;
 return public.space_avatar_self();
end;
$$;
create or replace function public.space_avatar_batch(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids)>24 then raise exception 'Request up to 24 visible avatars'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'settings',a.settings)) from public.space_avatar_profiles a join public.profiles p on p.id=a.user_id
 where a.user_id=any(p_ids) and a.use_on_profile and (p.membership_status='approved' and p.role in ('member','teacher','founder','admin')) and (p.id=auth.uid() or p.profile_visibility='club')),'[]'::jsonb);
end;
$$;

-- Expired positions immediately stop being readable. Physical cleanup is bounded
-- and opportunistic on map RPCs; no location history or extra cron setup is needed.
create or replace function public.space_map_prune()
returns void language sql security definer set search_path = '' as $$
 delete from public.space_location_shares where user_id in (select user_id from public.space_location_shares where expires_at<=now() order by expires_at limit 200);
$$;
revoke all on function public.space_map_prune() from public,anon,authenticated;

create or replace function public.space_map_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 perform public.space_map_prune();
 return jsonb_build_object('share',(select jsonb_build_object('share_id',s.share_id,'latitude',s.latitude,'longitude',s.longitude,'accuracy',s.accuracy,'precision_mode',s.precision_mode,'expires_at',s.expires_at,'updated_at',s.updated_at) from public.space_location_shares s where s.user_id=caller and s.expires_at>now()),
 'recipients',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',case when p.profile_visibility='club' then p.full_name else 'Private member' end) order by p.id) from public.space_location_recipients r join public.profiles p on p.id=r.recipient_id join public.space_location_shares s on s.user_id=r.owner_id where r.owner_id=caller and s.expires_at>now()),'[]'::jsonb),'server_time',now());
end;
$$;
create or replace function public.space_map_people(p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>80 or p_page is null or p_page not between 0 and 10000 then raise exception 'Invalid people search'; end if;
 with eligible as(select p.id,p.full_name from public.profiles p where p.id<>auth.uid() and p.profile_visibility='club' and (p.membership_status='approved' and p.role in ('member','teacher','founder','admin')) and (p_search='' or strpos(lower(p.full_name),lower(btrim(p_search)))>0)),
 items as(select * from eligible order by lower(full_name),id limit 24 offset p_page*24)
 select jsonb_build_object('total',(select count(*) from eligible),'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by lower(full_name),id) from items),'[]'::jsonb)) into result;
 return result;
end;
$$;
create or replace function public.space_map_start(p_lat double precision,p_lng double precision,p_accuracy double precision,p_precision text,p_minutes integer,p_recipients uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); chosen uuid[]; share uuid:=gen_random_uuid();
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 if p_lat is null or not(p_lat between -90 and 90) or p_lng is null or not(p_lng between -180 and 180) or p_accuracy is null or not(p_accuracy between 0 and 50000)
 or p_precision is null or p_precision not in ('approximate','precise') or p_minutes is null or p_minutes not in (15,60,120) then raise exception 'Invalid sharing choices'; end if;
 if p_recipients is null or cardinality(p_recipients) not between 1 and 50 or array_position(p_recipients,null) is not null then raise exception 'Select between 1 and 50 approved members'; end if;
 select array_agg(distinct x) into chosen from unnest(p_recipients) x;
 if caller=any(chosen) or exists(select 1 from unnest(chosen) x where not public.space_map_member(x)) then raise exception 'Approved club recipients required'; end if;
 if p_precision='approximate' then p_lat:=round(p_lat::numeric,2)::double precision;p_lng:=round(p_lng::numeric,2)::double precision;p_accuracy:=greatest(1600,p_accuracy);end if;
 perform public.space_map_prune();
 insert into public.space_location_shares(user_id,share_id,latitude,longitude,accuracy,precision_mode,expires_at)
 values(caller,share,p_lat,p_lng,p_accuracy,p_precision,now()+make_interval(mins=>p_minutes))
 on conflict(user_id) do update set share_id=excluded.share_id,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,precision_mode=excluded.precision_mode,started_at=now(),updated_at=now(),expires_at=excluded.expires_at;
 delete from public.space_location_recipients where owner_id=caller;
 insert into public.space_location_recipients(owner_id,recipient_id) select caller,x from unnest(chosen) x;
 return public.space_map_state();
end;
$$;
create or replace function public.space_map_update(p_share uuid,p_lat double precision,p_lng double precision,p_accuracy double precision)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.space_location_shares;
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 if p_lat is null or not(p_lat between -90 and 90) or p_lng is null or not(p_lng between -180 and 180) or p_accuracy is null or not(p_accuracy between 0 and 50000) then raise exception 'Invalid position'; end if;
 select * into s from public.space_location_shares where user_id=auth.uid() and share_id=p_share and expires_at>now() for update;
 if not found then return false; end if;
 if s.updated_at>now()-interval '10 seconds' then return true; end if;
 if s.precision_mode='approximate' then p_lat:=round(p_lat::numeric,2)::double precision;p_lng:=round(p_lng::numeric,2)::double precision;p_accuracy:=greatest(1600,p_accuracy);end if;
 update public.space_location_shares set latitude=p_lat,longitude=p_lng,accuracy=p_accuracy,updated_at=now() where user_id=auth.uid() and share_id=p_share;
 return true;
end;
$$;
create or replace function public.space_map_stop(p_share uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 delete from public.space_location_shares where user_id=auth.uid() and (p_share is null or share_id=p_share);
 return found;
end;
$$;
create or replace function public.space_map_points(p_south double precision default -90,p_north double precision default 90,p_west double precision default -180,p_east double precision default 180,p_page integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;caller uuid:=auth.uid();
begin
 if not public.space_map_member() then raise exception 'Approved club access required' using errcode='42501'; end if;
 if p_south is null or p_north is null or not(p_south between -90 and 90) or not(p_north between p_south and 90) or p_west is null or p_east is null or not(p_west between -180 and 180) or not(p_east between -180 and 180) or p_page is null or p_page not between 0 and 10000 then raise exception 'Invalid map bounds';end if;
 perform public.space_map_prune();
 with eligible as(select s.*,p.full_name,p.profile_visibility,a.settings from public.space_location_shares s join public.profiles p on p.id=s.user_id left join public.space_avatar_profiles a on a.user_id=s.user_id
 where s.expires_at>now() and (p.membership_status='approved' and p.role in ('member','teacher','founder','admin')) and (s.user_id=caller or exists(select 1 from public.space_location_recipients r where r.owner_id=s.user_id and r.recipient_id=caller))
 and s.latitude between p_south and p_north and (case when p_west<=p_east then s.longitude between p_west and p_east else s.longitude>=p_west or s.longitude<=p_east end)),
 items as(select * from eligible order by user_id limit 100 offset p_page*100)
 select jsonb_build_object('total',(select count(*) from eligible),'points',coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'name',case when user_id=caller or profile_visibility='club' then full_name else 'Private member' end,'profile_open',user_id=caller or profile_visibility='club','latitude',latitude,'longitude',longitude,'accuracy',accuracy,'precision_mode',precision_mode,'updated_at',updated_at,'expires_at',expires_at,'avatar',coalesce(settings,public.space_avatar_default())) order by user_id) from items),'[]'::jsonb),
 'places',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'kind',v.kind,'description',v.description,'latitude',v.latitude,'longitude',v.longitude,'starts_at',v.starts_at) order by v.starts_at nulls last,v.id) from (select * from public.space_map_places where (starts_at is null or starts_at>now()-interval '1 day') and latitude between p_south and p_north and (case when p_west<=p_east then longitude between p_west and p_east else longitude>=p_west or longitude<=p_east end) order by starts_at nulls last,id limit 100) v),'[]'::jsonb),'server_time',now()) into result;
 return result;
end;
$$;
create or replace function public.space_map_save_place(p_id uuid,p_title text,p_kind text,p_description text,p_lat double precision,p_lng double precision,p_starts timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare chosen uuid:=coalesce(p_id,gen_random_uuid());
begin
 if not public.space_map_member() or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 120 or p_kind is null or p_kind not in ('workshop','event','meetup') or p_description is null or length(p_description)>500 or p_lat is null or not(p_lat between -90 and 90) or p_lng is null or not(p_lng between -180 and 180) then raise exception 'Invalid venue';end if;
 insert into public.space_map_places(id,title,kind,description,latitude,longitude,starts_at,created_by) values(chosen,btrim(p_title),p_kind,btrim(p_description),p_lat,p_lng,p_starts,auth.uid())
 on conflict(id) do update set title=excluded.title,kind=excluded.kind,description=excluded.description,latitude=excluded.latitude,longitude=excluded.longitude,starts_at=excluded.starts_at,updated_at=now();return chosen;
end;
$$;
create or replace function public.space_map_delete_place(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if not public.space_map_member() or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
 delete from public.space_map_places where id=p_id;return found;
end;
$$;

-- Revoke PostgreSQL's default PUBLIC execute, then expose only the intended RPCs.
revoke all on function public.space_avatar_self(),public.space_avatar_save(jsonb,boolean,boolean,integer,text),public.space_avatar_delete_look(integer),public.space_avatar_batch(uuid[]),public.space_map_state(),public.space_map_people(text,integer),public.space_map_start(double precision,double precision,double precision,text,integer,uuid[]),public.space_map_update(uuid,double precision,double precision,double precision),public.space_map_stop(uuid),public.space_map_points(double precision,double precision,double precision,double precision,integer),public.space_map_save_place(uuid,text,text,text,double precision,double precision,timestamptz),public.space_map_delete_place(uuid) from public,anon;
grant execute on function public.space_avatar_self(),public.space_avatar_save(jsonb,boolean,boolean,integer,text),public.space_avatar_delete_look(integer),public.space_avatar_batch(uuid[]),public.space_map_state(),public.space_map_people(text,integer),public.space_map_start(double precision,double precision,double precision,text,integer,uuid[]),public.space_map_update(uuid,double precision,double precision,double precision),public.space_map_stop(uuid),public.space_map_points(double precision,double precision,double precision,double precision,integer),public.space_map_save_place(uuid,text,text,text,double precision,double precision,timestamptz),public.space_map_delete_place(uuid) to authenticated;
commit;
