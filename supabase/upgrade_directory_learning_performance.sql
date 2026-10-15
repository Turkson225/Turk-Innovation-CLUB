-- Run the entire file after upgrade_advanced_platform.sql.
-- Read-only directory pagination and equivalent, statement-cached access checks.
begin;
do $$ begin
 if to_regclass('public.classroom_assignment_submissions') is null
   or to_regclass('public.space_course_lessons') is null then
   raise exception 'Run the learning dashboards and advanced platform upgrades first';
 end if;
end $$;

-- These role checks depend on the caller, not on an individual profile row.
drop policy if exists "Member directory" on public.profiles;
create policy "Member directory" on public.profiles for select to authenticated using(
 id=(select auth.uid()) or (select public.is_admin()) or
 ((select public.is_approved()) and membership_status='approved' and role<>'investor' and profile_visibility='club')
);
drop policy if exists "Own classwork or assigned teacher" on public.classroom_assignment_submissions;
create policy "Own classwork or assigned teacher" on public.classroom_assignment_submissions for select to authenticated using(
 (select public.is_approved()) and (learner_id=(select auth.uid()) or exists(
  select 1 from public.classroom_assignments a where a.id=assignment_id and public.manages_classroom(a.course_id)
 ))
);

create or replace function public.space_directory_text(p_value text) returns text
language sql immutable set search_path='' as $$
 select lower(regexp_replace(normalize(coalesce(p_value,''),NFKD),U&'[\0300-\036f]','','g'))
$$;
create or replace function public.space_directory_interests(p_value text) returns text[]
language sql immutable set search_path='' as $$
 select coalesce(array_agg(label order by first_position),array[]::text[]) from (
  select min(trim(left(part,60))) label,min(position) first_position
  from regexp_split_to_table(left(coalesce(p_value,''),2000),'[,;\n]+') with ordinality s(part,position)
  where trim(part)<>'' group by public.space_directory_text(trim(left(part,60)))
  order by min(position) limit 16
 ) labels
$$;

create or replace function public.space_directory_interest_keys(p_value text) returns text[]
language sql immutable set search_path='' as $$
 select array(select public.space_directory_text(x) from unnest(public.space_directory_interests(p_value)) x)
$$;
-- Derived only from existing profile fields; recomputed automatically on edits.
-- No application answer, email, role claim or private learning data is copied.
alter table public.profiles add column if not exists directory_sort_name text generated always as (public.space_directory_text(full_name)) stored;
alter table public.profiles add column if not exists directory_search text generated always as
 (public.space_directory_text(coalesce(full_name,'')||' @'||coalesce(handle,'')||' '||coalesce(headline,'')||' '||coalesce(programme,'')||' '||coalesce(skills,''))) stored;
alter table public.profiles add column if not exists directory_interest_labels text[] generated always as
 (public.space_directory_interests(skills)) stored;
alter table public.profiles add column if not exists directory_interest_keys text[] generated always as
 (public.space_directory_interest_keys(skills)) stored;

-- INVOKER is deliberate: counts, facets and profiles use the caller's existing
-- RLS. A private profile cannot leak through totals, search or shared interests.
create or replace function public.space_member_directory(
 p_search text default '',p_role text default 'all',p_presence text default 'all',
 p_skill text default '',p_group text default 'all',p_sort text default 'online',
 p_saved uuid[] default array[]::uuid[],p_offset integer default 0,p_limit integer default 24
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;v_own text[];v_uid uuid:=(select auth.uid());
begin
 if not (select public.is_approved()) then raise exception 'Approved member access required';end if;
 if p_role not in ('all','member','leads','teacher','founder','admin')
  or p_presence not in ('all','online','available','busy','away')
  or p_group not in ('all','shared','new','saved') or p_sort not in ('online','name','newest','shared')
  or p_limit not between 1 and 48 or p_offset not between 0 and 1000000
  or length(coalesce(p_search,''))>120 or length(coalesce(p_skill,''))>60
  or coalesce(cardinality(p_saved),0)>500
  or p_role is null or p_presence is null or p_group is null or p_sort is null
  or p_limit is null or p_offset is null then raise exception 'Invalid directory filters';end if;
 select p.directory_interest_keys
 into v_own from public.profiles p where id=v_uid;
 with base as materialized (
  select p.id,p.full_name,p.role,p.founder_teaching_enabled,p.availability,p.created_at,p.directory_sort_name sort_name,
   p.last_seen_at between now()-interval '65 seconds' and now() online,
   p.created_at between now()-interval '30 days' and now() is_new,
   p.id=any(coalesce(p_saved,array[]::uuid[])) saved,
   p.directory_interest_labels interests,p.directory_interest_keys interest_keys,p.directory_search searchable
  from public.profiles p where p.membership_status='approved' and p.role<>'investor'
 ), scored as materialized (
  select b.*,case when b.id=v_uid then 0 else
   (select count(*)::int from unnest(b.interest_keys) x where x=any(coalesce(v_own,array[]::text[]))) end shared
  from base b
 ), filtered as materialized (
  select s.* from scored s where
   (p_role='all' or p_role=s.role or p_role='leads' and (s.role='teacher' or s.role='founder' and s.founder_teaching_enabled))
   and (p_presence='all' or p_presence='online' and s.online or p_presence=s.availability)
   and (p_group='all' or p_group='saved' and s.saved or p_group='new' and s.is_new or p_group='shared' and s.shared>0)
   and (coalesce(p_skill,'')='' or public.space_directory_text(p_skill)=any(s.interest_keys))
   and not exists(select 1 from regexp_split_to_table(trim(public.space_directory_text(p_search)),'\s+') term
    where term<>'' and strpos(s.searchable,term)=0)
 ), tally as (select count(*)::int total from filtered), bounds as (
  select total,case when total=0 then 0 when p_offset>=total then ((total-1)/p_limit)*p_limit else p_offset end row_offset from tally
 ), selected as (
  select f.* from filtered f order by
   case when p_sort='online' then coalesce(f.online,false)::int end desc nulls last,
   case when p_sort='shared' then f.shared end desc nulls last,
   case when p_sort='newest' then f.created_at end desc nulls last,
   f.sort_name,f.id
  limit p_limit offset (select row_offset from bounds)
 ), facets as (
  select min(f.label) label,count(*)::int count from scored s cross join lateral unnest(s.interests,s.interest_keys) f(label,key)
  group by f.key order by count(*) desc,min(f.label) limit 100
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'handle',p.handle,
   'headline',p.headline,'bio',p.bio,'programme',p.programme,'skills',p.skills,'role',p.role,
   'membership_status',p.membership_status,'profile_visibility',p.profile_visibility,
   'founder_teaching_enabled',p.founder_teaching_enabled,'availability',p.availability,'avatar_path',p.avatar_path,
   'last_seen_at',p.last_seen_at,'created_at',p.created_at) order by case when p_sort='online' then coalesce(s.online,false)::int end desc nulls last,case when p_sort='shared' then s.shared end desc nulls last,case when p_sort='newest' then s.created_at end desc nulls last,s.sort_name,s.id) from selected s join public.profiles p on p.id=s.id),'[]'::jsonb),
  'total',(select total from bounds),'offset',(select row_offset from bounds),
  'stats',(select jsonb_build_object('all',count(*),'online',count(*) filter(where online),'new',count(*) filter(where is_new),
    'shared',count(*) filter(where shared>0),'saved',count(*) filter(where saved)) from scored),
  'skills',coalesce((select jsonb_agg(to_jsonb(f)) from facets f),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.space_directory_text(text),public.space_directory_interests(text),public.space_directory_interest_keys(text),public.space_member_directory(text,text,text,text,text,text,uuid[],integer,integer) from public,anon;
grant execute on function public.space_directory_text(text),public.space_directory_interests(text),public.space_directory_interest_keys(text),public.space_member_directory(text,text,text,text,text,text,uuid[],integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
