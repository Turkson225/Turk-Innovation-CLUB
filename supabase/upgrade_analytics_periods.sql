-- SPACE administrator analytics. Run the whole file in Supabase SQL Editor.
-- Uses existing profile/finance RLS; does not grant access to private application answers.
begin;

create or replace function public.space_admin_analytics(
  p_scope text, p_from date, p_through date, p_grain text default 'day',
  p_status text default 'approved'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_rows jsonb; v_summary jsonb; v_step interval;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_scope is null or p_scope not in ('membership','finance') then raise exception 'Unknown analytics scope'; end if;
  if p_grain is null or p_grain not in ('day','month','year') then raise exception 'Choose day, month or year'; end if;
  if p_status is null or p_status not in ('approved','all') then raise exception 'Choose approved or all accounts'; end if;
  if p_from is null or p_through is null or p_from < date '2000-01-01' or p_through > v_today
     or p_from > p_through or p_through >= (p_from + interval '10 years')::date then
    raise exception 'Choose a valid period of less than 10 years, ending no later than today (UTC)';
  end if;
  if p_grain = 'day' and p_through-p_from > 365 then raise exception 'Daily grouping allows up to 366 days. Choose month or year for a longer period'; end if;
  v_step := case p_grain when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '1 year' end;
  if p_scope = 'membership' then
    with buckets as (
      select d::date as period_start, greatest(d::date,p_from) as period_from,
        least((d+v_step-interval '1 day')::date,p_through) as period_through
      from pg_catalog.generate_series(pg_catalog.date_trunc(p_grain,p_from::timestamp),pg_catalog.date_trunc(p_grain,p_through::timestamp),v_step) d
    ), counts as (
      select pg_catalog.date_trunc(p_grain,p.created_at at time zone 'UTC')::date as period_start,
        count(*) filter(where p.role='member') as member,
        count(*) filter(where p.role='teacher') as teacher,
        count(*) filter(where p.role='founder') as founder,
        count(*) filter(where p.role='investor') as investor,
        count(*) filter(where p.role='admin') as admin
      from public.profiles p where p.created_at >= p_from::timestamp at time zone 'UTC'
        and p.created_at < (p_through+1)::timestamp at time zone 'UTC' and p.created_at<=now()
        and (p_status='all' or p.membership_status='approved') group by 1
    ) select coalesce(jsonb_agg(jsonb_build_object('date',b.period_start,'from',b.period_from,'through',b.period_through,
      'member',coalesce(c.member,0),'teacher',coalesce(c.teacher,0),'founder',coalesce(c.founder,0),
      'investor',coalesce(c.investor,0),'admin',coalesce(c.admin,0)) order by b.period_start),'[]'::jsonb)
      into v_rows from buckets b left join counts c using(period_start);
    select jsonb_build_object('accounts',count(*),'approved',count(*) filter(where membership_status='approved'),
      'pending',count(*) filter(where membership_status='pending')) into v_summary
      from public.profiles p where p.created_at >= p_from::timestamp at time zone 'UTC'
        and p.created_at < (p_through+1)::timestamp at time zone 'UTC' and p.created_at<=now()
        and (p_status='all' or p.membership_status='approved');
  else
    with buckets as (
      select d::date as period_start,greatest(d::date,p_from) as period_from,
        least((d+v_step-interval '1 day')::date,p_through) as period_through
      from pg_catalog.generate_series(pg_catalog.date_trunc(p_grain,p_from::timestamp),pg_catalog.date_trunc(p_grain,p_through::timestamp),v_step) d
    ), amounts as (
      select pg_catalog.date_trunc(p_grain,e.occurred_on::timestamp)::date as period_start,
        sum(e.amount) filter(where e.entry_type='income') as income,
        sum(e.amount) filter(where e.entry_type='expense') as expense
      from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved'
      where e.occurred_on between p_from and p_through group by 1
    ) select coalesce(jsonb_agg(jsonb_build_object('date',b.period_start,'from',b.period_from,'through',b.period_through,
      'income',coalesce(a.income,0),'expense',coalesce(a.expense,0)) order by b.period_start),'[]'::jsonb)
      into v_rows from buckets b left join amounts a using(period_start);
    select jsonb_build_object(
      'income',coalesce(sum(e.amount) filter(where e.entry_type='income' and e.occurred_on>=p_from),0),
      'expense',coalesce(sum(e.amount) filter(where e.entry_type='expense' and e.occurred_on>=p_from),0),
      'transactions',count(*) filter(where e.occurred_on>=p_from),
      'opening',coalesce(sum(case when e.entry_type='income' then e.amount else -e.amount end) filter(where e.occurred_on<p_from),0),
      'closing',coalesce(sum(case when e.entry_type='income' then e.amount else -e.amount end),0))
      into v_summary from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved'
      where e.occurred_on<=p_through;
  end if;
  return jsonb_build_object('scope',p_scope,'from',p_from,'through',p_through,'grain',p_grain,'status',p_status,
    'timezone','UTC','generated_at',now(),'rows',v_rows,'summary',v_summary);
end;
$$;
revoke all on function public.space_admin_analytics(text,date,date,text,text) from public,anon;
grant execute on function public.space_admin_analytics(text,date,date,text,text) to authenticated;

-- Keyset-paginated member export. One JSON result per request avoids API row caps.
-- as_of fixes the creation cutoff, not subsequent role/status/name edits.
create or replace function public.space_analytics_members(
  p_from date, p_through date, p_status text default 'approved',
  p_after_created timestamptz default null, p_after_id uuid default null,
  p_as_of timestamptz default null, p_limit integer default 500
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_cutoff timestamptz := least(coalesce(p_as_of,now()),now());
  v_rows jsonb; v_total bigint; v_more boolean; v_last jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_through is null or p_from < date '2000-01-01'
    or p_through > (now() at time zone 'UTC')::date or p_from>p_through
    or p_through >= (p_from+interval '10 years')::date then raise exception 'Choose a valid export period'; end if;
  if p_status is null or p_status not in ('approved','all') then raise exception 'Choose approved or all accounts'; end if;
  if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Export page size must be 1 to 500'; end if;
  if (p_after_created is null) <> (p_after_id is null) then raise exception 'Both export cursor values are required'; end if;
  select count(*) into v_total from public.profiles p where p.created_at>=p_from::timestamp at time zone 'UTC'
    and p.created_at<(p_through+1)::timestamp at time zone 'UTC' and p.created_at<=v_cutoff
    and (p_status='all' or p.membership_status='approved');
  with candidates as (
    select p.id,p.full_name,p.handle,p.role,p.membership_status,p.created_at
    from public.profiles p where p.created_at>=p_from::timestamp at time zone 'UTC'
      and p.created_at<(p_through+1)::timestamp at time zone 'UTC' and p.created_at<=v_cutoff
      and (p_status='all' or p.membership_status='approved')
      and (p_after_created is null or (p.created_at,p.id)>(p_after_created,p_after_id))
    order by p.created_at,p.id limit p_limit+1
  ), numbered as (select *,row_number() over(order by created_at,id) as n from candidates)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'handle',handle,
    'role',role,'membership_status',membership_status,'created_at',created_at) order by created_at,id) filter(where n<=p_limit),'[]'::jsonb),
    coalesce(bool_or(n>p_limit),false) into v_rows,v_more from numbered;
  v_last := v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('rows',v_rows,'total',v_total,'more',v_more,'as_of',v_cutoff,
    'next_created',case when v_more then v_last->>'created_at' else null end,
    'next_id',case when v_more then v_last->>'id' else null end);
end;
$$;
revoke all on function public.space_analytics_members(date,date,text,timestamptz,uuid,timestamptz,integer) from public,anon;
grant execute on function public.space_analytics_members(date,date,text,timestamptz,uuid,timestamptz,integer) to authenticated;
create index if not exists space_analytics_profile_cursor on public.profiles(created_at,id);
create index if not exists space_analytics_finance_date on public.finance_entries(occurred_on,id);
commit;
