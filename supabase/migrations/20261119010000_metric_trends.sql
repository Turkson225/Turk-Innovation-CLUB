-- Read-only trend history for existing SPACE records; no fake backfill or new data access.
begin;

do $$ begin
  if to_regclass('public.space_chapter_office_tasks') is null then
    raise exception 'Apply the chapter operations migration first.';
  end if;
end $$;

create index if not exists space_trend_stock_created_idx on public.inventory_items(created_at);
create index if not exists space_trend_stock_movement_idx on public.inventory_movements(created_at)
  where kind in ('check_out','return');
create index if not exists space_trend_collections_idx on public.space_shop_orders(collected_at)
  where collected_at is not null and status='collected';
create index if not exists space_trend_chapter_requests_idx on public.space_chapter_memberships(requested_at,chapter_id);
create index if not exists space_trend_chapter_activations_idx on public.audit_events(created_at,target_id)
  where target_type='chapter_membership' and action='chapter_membership_active';
create index if not exists space_trend_chapter_published_idx on public.space_chapter_activities(created_at,chapter_id);
create index if not exists space_trend_chapter_task_creation_idx on public.space_chapter_office_tasks(created_at,chapter_id);
create index if not exists space_trend_chapter_task_completion_idx on public.space_chapter_office_tasks(completed_at,chapter_id)
  where status='completed';

-- Use caller/RLS for standard metrics. Chapter office and report functions below
-- need explicit entitlement checks because their source ledgers are RPC-only.
create or replace function public.space_metric_trends(p_scope text,p_grain text,p_from date,p_through date,p_target uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_me uuid:=(select auth.uid()); v_admin boolean:=public.is_admin();
  v_first timestamptz; v_last timestamptz; v_step interval; v_rows jsonb; v_keys text[];
begin
  if not public.is_approved() or not exists(select 1 from public.profiles p where p.id=v_me and p.role<>'investor') then
    raise exception 'Approved club access required' using errcode='42501';
  end if;
  if p_scope is null or p_scope not in ('learning','teaching','inventory','orders') then raise exception 'Unknown trend scope'; end if;
  if p_scope='teaching' and not public.is_teacher() then raise exception 'Teaching access required' using errcode='42501'; end if;
  if p_target is not null and (p_scope not in ('learning','teaching') or not exists(
    select 1 from public.courses c where c.id=p_target and (
      (p_scope='teaching' and (v_admin or c.instructor_id=v_me)) or
      (p_scope='learning' and exists(select 1 from public.course_enrollments e where e.course_id=c.id and e.learner_id=v_me))
    ))) then raise exception 'Class unavailable' using errcode='42501'; end if;
  if p_grain is null or p_grain not in ('day','month','year') or p_from is null or p_through is null or
    p_from<date '2000-01-01' or p_through>(now() at time zone 'UTC')::date or p_from>p_through or
    (p_grain='day' and p_through-p_from>=366) or p_through>=(p_from+interval '10 years')::date then raise exception 'Choose a valid reporting period'; end if;

  v_first:=p_from::timestamp at time zone 'UTC';v_last:=least(now(),(p_through+1)::timestamp at time zone 'UTC');
  v_step:=case p_grain when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '1 year' end;
  v_keys:=case p_scope
    when 'inventory' then case when public.is_founder() then array['stock_created','checkouts','returns'] else array['stock_created'] end
    when 'orders' then array['orders_created','orders_collected']
    else array['enrollments','attempts','completions'] end;

  with courses_in_scope as materialized (
    select c.id from public.courses c
    where p_scope in ('learning','teaching') and (p_target is null or c.id=p_target)
      and (p_scope='learning' or v_admin or c.instructor_id=v_me)
  ), facts as (
    select e.created_at ts,'enrollments' k from public.course_enrollments e join courses_in_scope c on c.id=e.course_id
      where (p_scope='teaching' or e.learner_id=v_me) and e.created_at>=v_first and e.created_at<v_last
    union all select s.created_at,'attempts' from public.course_submissions s join courses_in_scope c on c.id=s.course_id
      where (p_scope='teaching' or s.learner_id=v_me) and s.created_at>=v_first and s.created_at<v_last
    union all select s.created_at,'attempts' from public.classroom_assignment_submissions s
       join public.classroom_assignments a on a.id=s.assignment_id join courses_in_scope c on c.id=a.course_id
      where (p_scope='teaching' or s.learner_id=v_me) and s.created_at>=v_first and s.created_at<v_last
    union all select s.completed_at,'completions' from public.course_completions s join courses_in_scope c on c.id=s.course_id
      where (p_scope='teaching' or s.learner_id=v_me) and s.completed_at>=v_first and s.completed_at<v_last
    union all select i.created_at,'stock_created' from public.inventory_items i
      where p_scope='inventory' and i.created_at>=v_first and i.created_at<v_last
    union all select m.created_at,case m.kind when 'check_out' then 'checkouts' else 'returns' end from public.inventory_movements m
      where p_scope='inventory' and public.is_founder() and m.kind in ('check_out','return') and m.created_at>=v_first and m.created_at<v_last
    union all select o.created_at,'orders_created' from public.space_shop_orders o
      where p_scope='orders' and (v_admin or o.buyer_id=v_me) and o.created_at>=v_first and o.created_at<v_last
    union all select o.collected_at,'orders_collected' from public.space_shop_orders o
      where p_scope='orders' and (v_admin or o.buyer_id=v_me) and o.status='collected' and o.collected_at>=v_first and o.collected_at<v_last
  ), stats as (
    select date_trunc(p_grain,ts at time zone 'UTC') b,k,count(*) n from facts group by 1,2
  ), buckets as (
    select d, jsonb_object_agg(metric,coalesce(n,0)) amounts
    from generate_series(date_trunc(p_grain,p_from::timestamp),date_trunc(p_grain,p_through::timestamp),v_step) d
    cross join unnest(v_keys) as keys(metric) left join stats s on s.b=d and s.k=keys.metric group by d
  ) select jsonb_agg(jsonb_build_object('date',d::date,'from',greatest(d::date,p_from),
      'through',least((d+v_step-interval '1 day')::date,p_through),'values',amounts) order by d) into v_rows from buckets;
  return jsonb_build_object('series',v_keys,'rows',v_rows,'grain',p_grain,'from',p_from,'through',p_through,'unit','count');
end $$;

create or replace function public.space_chapter_metric_trends(p_chapter uuid,p_grain text,p_from date,p_through date,p_office text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_me uuid:=(select auth.uid());v_admin boolean:=public.is_admin();v_manage boolean;v_roles text[];v_status text;
  v_first timestamptz; v_last timestamptz; v_step interval; v_rows jsonb; v_keys text[];
begin
  if not space_private.is_chapter_participant() then raise exception 'Approved club access required' using errcode='42501'; end if;
  if p_chapter is null then
    if not v_admin or p_office is not null then raise exception 'Chapter network access requires an administrator' using errcode='42501'; end if;
    v_manage:=true;
  else
    select c.status into v_status from public.space_chapters c where c.id=p_chapter;
    select coalesce(array_agg(h.office),array[]::text[]) into v_roles
      from space_private.chapter_office_holders(p_chapter) h where h.user_id=v_me;
    if v_status is null or (not v_admin and (v_status<>'active' or cardinality(v_roles)=0)) then
      raise exception 'Chapter office access required' using errcode='42501';
    end if;
    v_manage:=v_admin or 'coordinator'=any(v_roles);
    if not v_manage and p_office is not null and not (p_office=any(v_roles)) then
      raise exception 'Office is not assigned to you' using errcode='42501';
    end if;
  end if;
  if p_office is not null and p_office not in ('coordinator','teacher','deputy_coordinator','secretary','treasurer','teaching_lead','events_lead','projects_lead','communications') then raise exception 'Choose a valid office'; end if;
  if p_grain is null or p_grain not in ('day','month','year') or p_from is null or p_through is null or
    p_from<date '2000-01-01' or p_through>(now() at time zone 'UTC')::date or p_from>p_through or
    (p_grain='day' and p_through-p_from>=366) or p_through>=(p_from+interval '10 years')::date then raise exception 'Choose a valid reporting period'; end if;

  v_first:=p_from::timestamp at time zone 'UTC';v_last:=least(now(),(p_through+1)::timestamp at time zone 'UTC');
  v_step:=case p_grain when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '1 year' end;
  v_keys:=case when v_manage and p_office is null then
    array['requests','activations','announcement','event','project','workshop','tasks_assigned','tasks_completed']
    else array['tasks_assigned','tasks_completed'] end;
  with facts as (
    select m.requested_at ts,'requests' k from public.space_chapter_memberships m
      where v_manage and p_office is null and (p_chapter is null or m.chapter_id=p_chapter) and m.requested_at>=v_first and m.requested_at<v_last
    union all select e.created_at,'activations' from public.audit_events e
      join public.space_chapter_memberships m on m.id=e.target_id
      where v_manage and p_office is null and (p_chapter is null or m.chapter_id=p_chapter)
        and e.target_type='chapter_membership' and e.action='chapter_membership_active' and e.created_at>=v_first and e.created_at<v_last
    union all select a.created_at,a.kind from public.space_chapter_activities a
      where v_manage and p_office is null and (p_chapter is null or a.chapter_id=p_chapter) and a.created_at>=v_first and a.created_at<v_last
    union all select t.created_at,'tasks_assigned' from public.space_chapter_office_tasks t
      where (p_chapter is null or t.chapter_id=p_chapter) and (p_office is null or t.office=p_office)
        and (v_manage or (t.assignee_id=v_me and t.office=any(v_roles))) and t.created_at>=v_first and t.created_at<v_last
    union all select t.completed_at,'tasks_completed' from public.space_chapter_office_tasks t
      where (p_chapter is null or t.chapter_id=p_chapter) and (p_office is null or t.office=p_office)
        and (v_manage or (t.assignee_id=v_me and t.office=any(v_roles))) and t.status='completed' and t.completed_at>=v_first and t.completed_at<v_last
  ), stats as (
    select date_trunc(p_grain,ts at time zone 'UTC') b,k,count(*) n from facts group by 1,2
  ), buckets as (
    select d, jsonb_object_agg(metric,coalesce(n,0)) amounts
    from generate_series(date_trunc(p_grain,p_from::timestamp),date_trunc(p_grain,p_through::timestamp),v_step) d
    cross join unnest(v_keys) as keys(metric) left join stats s on s.b=d and s.k=keys.metric group by d
  ) select jsonb_agg(jsonb_build_object('date',d::date,'from',greatest(d::date,p_from),
      'through',least((d+v_step-interval '1 day')::date,p_through),'values',amounts) order by d) into v_rows from buckets;
  return jsonb_build_object('series',v_keys,'rows',v_rows,'grain',p_grain,'from',p_from,'through',p_through,'unit','count');
end $$;

-- Entitlement is the same as the approved monthly finance report.
create or replace function public.space_approved_ledger_trends(p_grain text,p_from date,p_through date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_step interval;v_rows jsonb;
begin
  if not space_private.is_chapter_participant() or not (public.is_admin() or public.has_officer_role('treasurer')) then
    raise exception 'Finance report access required' using errcode='42501';
  end if;
  if p_grain is null or p_grain not in ('day','month','year') or p_from is null or p_through is null or
    p_from<date '2000-01-01' or p_through>(now() at time zone 'UTC')::date or p_from>p_through or
    (p_grain='day' and p_through-p_from>=366) or p_through>=(p_from+interval '10 years')::date then raise exception 'Choose a valid reporting period'; end if;
  v_step:=case p_grain when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '1 year' end;

  with amounts as (
    select date_trunc(p_grain,e.occurred_on::timestamp) b,
      sum(e.amount) filter(where e.entry_type='income') income,sum(e.amount) filter(where e.entry_type='expense') expense
    from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved'
    where e.occurred_on between p_from and p_through group by 1
  )
  select jsonb_agg(jsonb_build_object('date',d::date,'from',greatest(d::date,p_from),
    'through',least((d+v_step-interval '1 day')::date,p_through),'values',jsonb_build_object('income',coalesce(a.income,0),'expense',coalesce(a.expense,0))) order by d) into v_rows
  from generate_series(date_trunc(p_grain,p_from::timestamp),date_trunc(p_grain,p_through::timestamp),v_step) d
  left join amounts a on a.b=d;
  return jsonb_build_object('series',array['income','expense'],'rows',v_rows,'grain',p_grain,'from',p_from,'through',p_through,'unit','GHS');
end $$;

-- A manual trend follows one owner's label, unit and workshop. Read the latest
-- revision of each observation; absent periods are unknown, not zero.
create or replace function public.space_manual_metric_trends(p_root uuid,p_grain text,p_from date,p_through date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_owner uuid;v_course uuid;v_scope text;v_label text;v_unit text;v_step interval;v_rows jsonb;
begin
  if not public.is_approved() or not (public.is_admin() or public.is_teacher()) then
    raise exception 'Manual metric access required' using errcode='42501';
  end if;
  if p_grain is null or p_grain not in ('day','month','year') or p_from is null or p_through is null or
    p_from<date '2000-01-01' or p_through>(now() at time zone 'UTC')::date or p_from>p_through or
    (p_grain='day' and p_through-p_from>=366) or p_through>=(p_from+interval '10 years')::date then raise exception 'Choose a valid reporting period'; end if;
  select m.owner_id,m.course_id,m.scope,m.label,m.unit into v_owner,v_course,v_scope,v_label,v_unit
    from public.space_manual_metrics m where m.root_id=p_root order by m.revision desc limit 1;
  if not found then raise exception 'Manual metric unavailable' using errcode='42501'; end if;
  v_step:=case p_grain when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '1 year' end;

  with by_period as (
    select distinct on (b) date_trunc(p_grain,m.observed_on::timestamp) b,m.actual,m.target,m.observed_on
    from public.space_manual_metrics m
    where m.owner_id=v_owner and m.scope=v_scope and m.course_id is not distinct from v_course
      and m.label=v_label and m.unit=v_unit and m.observed_on between p_from and p_through
      and not exists(select 1 from public.space_manual_metrics newer where newer.supersedes_id=m.id)
    order by b,m.observed_on desc,m.created_at desc,m.id desc
  ) select jsonb_agg(jsonb_build_object('date',d::date,'from',greatest(d::date,p_from),
    'through',least((d+v_step-interval '1 day')::date,p_through),'observed',m.observed_on,
    'values',jsonb_build_object('actual',m.actual,'target',m.target)) order by d) into v_rows
  from generate_series(date_trunc(p_grain,p_from::timestamp),date_trunc(p_grain,p_through::timestamp),v_step) d
  left join by_period m on m.b=d;
  return jsonb_build_object('series',array['actual','target'],'rows',v_rows,'grain',p_grain,'from',p_from,'through',p_through,'unit',v_unit);
end $$;

revoke all on function public.space_metric_trends(text,text,date,date,uuid),
  public.space_chapter_metric_trends(uuid,text,date,date,text),public.space_approved_ledger_trends(text,date,date),
  public.space_manual_metric_trends(uuid,text,date,date)
  from public,anon,authenticated;
grant execute on function public.space_metric_trends(text,text,date,date,uuid),
  public.space_chapter_metric_trends(uuid,text,date,date,text),public.space_approved_ledger_trends(text,date,date),
  public.space_manual_metric_trends(uuid,text,date,date)
  to authenticated;

commit;
