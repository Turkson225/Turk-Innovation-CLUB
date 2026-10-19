-- Run the entire file after upgrade_space_metrics.sql. Safe to rerun.
-- Manual observations never change enrollment, stock, orders or the finance ledger.
begin;
do $$ begin
 if to_regprocedure('public.space_metrics(text,integer,uuid)') is null then raise exception 'Run upgrade_space_metrics.sql first'; end if;
end $$;
create table if not exists public.space_manual_metrics(
 id uuid primary key default gen_random_uuid(),root_id uuid not null references public.space_manual_metrics(id),
 revision integer not null check(revision>0),supersedes_id uuid unique references public.space_manual_metrics(id),
 owner_id uuid not null references public.profiles(id),recorded_by uuid not null references public.profiles(id),
 scope text not null check(scope in ('membership','learning','teaching','inventory','finance','orders')),
 course_id uuid references public.courses(id) on delete restrict,
 label text not null check(length(trim(label)) between 3 and 100),
 unit text not null check(unit in ('count','hours','percent','GHS')),
 actual numeric(14,2) not null check(actual>=0 and actual<=100000000000 and actual::text not in ('NaN','Infinity','-Infinity')),
 target numeric(14,2) check(target>0 and target<=100000000000 and target::text not in ('NaN','Infinity','-Infinity')),
 observed_on date not null,source text not null check(length(trim(source)) between 3 and 160),
 note text not null default '' check(length(note)<=1000),
 client_token uuid not null,request_fingerprint text not null,created_at timestamptz not null default now(),
 unique(root_id,revision),unique(recorded_by,client_token),
 check(course_id is null or scope in ('learning','teaching')),
 check(unit<>'percent' or actual<=100 and (target is null or target<=100)),
 check(unit<>'count' or actual=trunc(actual) and (target is null or target=trunc(target)))
);
create index if not exists space_manual_metrics_scope_date on public.space_manual_metrics(scope,course_id,observed_on desc,created_at desc,id);
create index if not exists space_manual_metrics_owner_date on public.space_manual_metrics(owner_id,observed_on desc);
alter table public.space_manual_metrics enable row level security;
revoke all on public.space_manual_metrics from public,anon,authenticated;
grant select on public.space_manual_metrics to authenticated;
drop policy if exists manual_metrics_read on public.space_manual_metrics;
create policy manual_metrics_read on public.space_manual_metrics for select to authenticated using(
 public.is_approved() and (public.is_admin() or
  owner_id=(select auth.uid()) and scope='teaching' and public.is_teacher() and exists(
   select 1 from public.courses c where c.id=course_id and c.instructor_id=(select auth.uid())
  ))
);
create or replace function public.space_manual_metrics_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Manual metric history is append-only; record a correction'; end $$;
revoke all on function public.space_manual_metrics_immutable() from public,anon,authenticated;
drop trigger if exists space_manual_metrics_immutable on public.space_manual_metrics;
create trigger space_manual_metrics_immutable before update or delete on public.space_manual_metrics
 for each row execute function public.space_manual_metrics_immutable();

create or replace function public.space_manual_metric_save(p_scope text,p_course uuid,p_label text,p_unit text,p_actual numeric,p_target numeric,p_observed date,p_source text,p_note text,p_token uuid,p_previous uuid default null)
returns uuid language plpgsql security definer set search_path='' as $save$
declare v_actor uuid:=auth.uid();v_admin boolean;v_id uuid:=gen_random_uuid();v_owner uuid;v_root uuid;v_revision integer:=1;v_old public.space_manual_metrics%rowtype;v_fingerprint text;v_existing public.space_manual_metrics%rowtype;
begin
 select role='admin' into v_admin from public.profiles where id=v_actor and membership_status='approved' and role in ('member','teacher','founder','admin') for share;
 if v_actor is null or v_admin is null then raise exception 'Approved editor access required' using errcode='42501'; end if;
 if p_scope is null or p_scope not in ('membership','learning','teaching','inventory','finance','orders') then raise exception 'Choose a manual metric scope';end if;
 if p_course is not null and p_scope not in ('learning','teaching') then raise exception 'Course does not belong to this scope';end if;
 if not v_admin and not(p_scope='teaching' and public.is_teacher() and p_course is not null) then raise exception 'Administrator or assigned teacher access required' using errcode='42501';end if;
 if p_course is not null then
  perform 1 from public.courses where id=p_course and (v_admin or instructor_id=v_actor) for share;
  if not found then raise exception 'Workshop unavailable' using errcode='42501';end if;
 end if;
 if p_token is null or p_label is null or length(trim(p_label)) not between 3 and 100 or p_source is null or length(trim(p_source)) not between 3 and 160 or length(coalesce(p_note,''))>1000 then raise exception 'Enter a label, source and valid note';end if;
 if p_unit is null or p_unit not in ('count','hours','percent','GHS') or p_actual is null or p_actual::text in ('NaN','Infinity','-Infinity') or p_actual<0 or p_actual>100000000000 or p_actual<>trunc(p_actual,2)
  or p_target is not null and (p_target::text in ('NaN','Infinity','-Infinity') or p_target<=0 or p_target>100000000000 or p_target<>trunc(p_target,2)) then raise exception 'Enter a nonnegative actual and positive optional target, with at most two decimals';end if;
 if p_unit='count' and (p_actual<>trunc(p_actual) or p_target is not null and p_target<>trunc(p_target)) or p_unit='percent' and (p_actual>100 or p_target>100) then raise exception 'Counts must be whole numbers; percentages cannot exceed 100';end if;
 if p_observed is null or p_observed<date '2000-01-01' or p_observed>(now() at time zone 'UTC')::date then raise exception 'Choose an observation date up to today';end if;
 v_fingerprint:=md5(jsonb_build_array(p_scope,p_course,trim(p_label),p_unit,p_actual,p_target,p_observed,trim(p_source),coalesce(trim(p_note),''),p_previous)::text);
 -- Serialize retries even before a first row exists. No external side effects.
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_token::text,0));
 select * into v_existing from public.space_manual_metrics where recorded_by=v_actor and client_token=p_token;
 if found then
  if v_existing.request_fingerprint<>v_fingerprint then raise exception 'This save token belongs to a different entry';end if;
  return v_existing.id;
 end if;
 v_owner:=v_actor;v_root:=v_id;
 if p_previous is not null then
  select * into v_old from public.space_manual_metrics where id=p_previous for update;
  if not found or not(v_admin or v_old.owner_id=v_actor and v_old.scope='teaching' and v_old.course_id=p_course)
   or v_old.scope<>p_scope or v_old.course_id is distinct from p_course then raise exception 'Entry unavailable' using errcode='42501';end if;
  if exists(select 1 from public.space_manual_metrics where supersedes_id=p_previous) then raise exception 'This entry was corrected already. Reload its latest version.';end if;
  if v_old.unit<>p_unit then raise exception 'Keep the original unit when correcting; use a new entry for a different measure';end if;
  v_owner:=v_old.owner_id;v_root:=v_old.root_id;v_revision:=v_old.revision+1;
 end if;
 insert into public.space_manual_metrics(id,root_id,revision,supersedes_id,owner_id,recorded_by,scope,course_id,label,unit,actual,target,observed_on,source,note,client_token,request_fingerprint)
 values(v_id,v_root,v_revision,p_previous,v_owner,v_actor,p_scope,p_course,trim(p_label),p_unit,p_actual,p_target,p_observed,trim(p_source),coalesce(trim(p_note),''),p_token,v_fingerprint);
 return v_id;
end;
$save$;
revoke all on function public.space_manual_metric_save(text,uuid,text,text,numeric,numeric,date,text,text,uuid,uuid) from public,anon;
grant execute on function public.space_manual_metric_save(text,uuid,text,text,numeric,numeric,date,text,text,uuid,uuid) to authenticated;

create or replace function public.space_manual_metric_list(p_scope text,p_days integer default 30,p_course uuid default null,p_offset integer default 0,p_root uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $list$
declare v_first date;v_count bigint;v_rows jsonb;
begin
 if not(public.is_admin() or public.is_teacher()) or not public.is_approved() then raise exception 'Editor access required' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('membership','learning','teaching','inventory','finance','orders') or p_days is null or p_days not in (7,30,90) or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid manual metrics view';end if;
 if not public.is_admin() and p_scope<>'teaching' then raise exception 'Teacher workshop access required' using errcode='42501';end if;
 v_first:=(now() at time zone 'UTC')::date-(p_days-1);
 with visible as materialized(
  select m.* from public.space_manual_metrics m where scope=p_scope and (p_course is null or course_id=p_course) and
   (p_root is not null and root_id=p_root or p_root is null and observed_on>=v_first and observed_on<=(now() at time zone 'UTC')::date and not exists(select 1 from public.space_manual_metrics newer where newer.supersedes_id=m.id))
 ), batch as(select * from visible order by created_at desc,id desc offset p_offset limit 20)
 select (select count(*) from visible),coalesce((select jsonb_agg(jsonb_build_object(
   'id',b.id,'root_id',b.root_id,'revision',b.revision,'course_id',b.course_id,'course_title',(select c.title from public.courses c where c.id=b.course_id),
   'label',b.label,'unit',b.unit,'actual',b.actual,'target',b.target,'observed_on',b.observed_on,'source',b.source,'note',b.note,'created_at',b.created_at,
   'is_mine',b.recorded_by=auth.uid()) order by b.created_at desc,b.id desc) from batch b),'[]'::jsonb)
 into v_count,v_rows;
 return jsonb_build_object('entries',v_rows,'total',v_count,'offset',p_offset,'history',p_root is not null);
end;
$list$;
revoke all on function public.space_manual_metric_list(text,integer,uuid,integer,uuid) from public,anon;
grant execute on function public.space_manual_metric_list(text,integer,uuid,integer,uuid) to authenticated;
commit;
