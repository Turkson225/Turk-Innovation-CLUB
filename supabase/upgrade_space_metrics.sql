-- Run the entire file in SQL Editor after the learning dashboards and
-- officer/finance upgrades. Shop metrics also need upgrade_club_shop.sql.
-- Read-only, SECURITY INVOKER aggregates: existing row-level policies still apply.
begin;

create index if not exists space_metrics_profile_created on public.profiles(created_at);
create index if not exists space_metrics_channel_recent on public.channel_messages(channel_id,created_at desc) where deleted_at is null;

create or replace function public.space_metrics(p_scope text, p_days integer default 30, p_target uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $metrics$
declare
 v_user uuid := auth.uid(); v_admin boolean; v_role text;
 v_now timestamptz := now(); v_first date; v_start timestamptz;
 v_kpis jsonb := '[]'; v_charts jsonb := '[]'; v_series jsonb := '[]'; v_rows jsonb := '[]';
 v_notes text[] := array[]::text[]; v_title text;
begin
 select role into v_role from public.profiles where id=v_user and membership_status='approved';
 if v_user is null or v_role is null or v_role not in ('member','teacher','founder','admin') then
   raise exception 'Approved club access required' using errcode='42501';
 end if;
 v_admin := v_role='admin';
 if p_days is null or p_days not in (7,30,90) then raise exception 'Choose 7, 30 or 90 days'; end if;
 if p_scope is null or p_scope not in ('membership','learning','teaching','inventory','finance','orders','dm','channel') then raise exception 'Unknown metrics scope'; end if;
 if p_scope in ('membership','finance') and not v_admin then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_scope='teaching' and not public.is_teacher() then raise exception 'Teacher access required' using errcode='42501'; end if;
 if p_target is not null and p_scope not in ('dm','channel','learning','teaching') then raise exception 'This scope does not accept a target'; end if;
 if p_scope='dm' and p_target=v_user then raise exception 'Choose another participant'; end if;
 if p_scope='channel' and (p_target is null or not exists(select 1 from public.channels where id=p_target)) then
   raise exception 'Channel unavailable' using errcode='42501';
 end if;
 if p_target is not null and p_scope in ('learning','teaching') and not exists(
   select 1 from public.courses c where c.id=p_target and
    (p_scope='teaching' and (v_admin or c.instructor_id=v_user) or
     p_scope='learning' and exists(select 1 from public.course_enrollments e where e.course_id=c.id and e.learner_id=v_user))
 ) then raise exception 'Class unavailable' using errcode='42501'; end if;
 v_first := (v_now at time zone 'UTC')::date-(p_days-1);
 v_start := v_first::timestamp at time zone 'UTC';

 if p_scope='membership' then
  v_title := 'Membership overview';
  select jsonb_build_array(
   jsonb_build_object('label','Approved accounts','value',count(*) filter(where membership_status='approved'),'detail','Current snapshot · all categories'),
   jsonb_build_object('label','Pending applications','value',count(*) filter(where membership_status='pending'),'detail','Current snapshot · awaiting approval'),
   jsonb_build_object('label','New accounts','value',count(*) filter(where created_at>=v_start and created_at<=v_now),'detail','Created during the selected period'),
   jsonb_build_object('label','Seen in 7 days','value',count(*) filter(where membership_status='approved' and last_seen_at>=v_now-interval '7 days' and last_seen_at<=v_now),'detail','Approved accounts · last recorded presence')
  ) into v_kpis from public.profiles;
  select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value) order by value desc,label),'[]') into v_rows
   from(select membership_status label,count(*) value from public.profiles group by membership_status) s;
  v_charts:=jsonb_build_array(jsonb_build_object('id','membership-status','title','Current application status','kind','bar','rows',v_rows));
  select jsonb_agg(jsonb_build_object('label',d::date,'value',coalesce(a.n,0)) order by d) into v_series
   from generate_series(v_first::timestamp,(v_now at time zone 'UTC')::date::timestamp,interval '1 day') d
   left join(select (created_at at time zone 'UTC')::date as activity_date,count(*) n from public.profiles where created_at>=v_start and created_at<=v_now group by 1)a on a.activity_date=d::date;
  v_notes:=array['New accounts counts account creation, not verified applications or approvals. Status totals describe the current snapshot, not past status transitions.','Seen in 7 days uses the latest presence timestamp; it is not a daily active-user history.'];

 elsif p_scope in ('learning','teaching') then
  v_title:=case when p_scope='teaching' then 'Teaching overview' else 'My learning progress' end;
  with enrollments as materialized (
   select e.* from public.course_enrollments e join public.courses c on c.id=e.course_id
    where (p_target is null or e.course_id=p_target) and
     (p_scope='learning' and e.learner_id=v_user or p_scope='teaching' and (v_admin or c.instructor_id=v_user))
  ) select jsonb_build_array(
   jsonb_build_object('label',case when p_scope='teaching' then 'Learners' else 'Enrolled workshops' end,'value',case when p_scope='teaching' then count(distinct learner_id) else count(*) end,'detail','Current scope · all enrollment dates'),
   jsonb_build_object('label','Active enrollments','value',count(*) filter(where status='enrolled'),'detail','Current scope · all enrollment dates'),
   jsonb_build_object('label','Completed enrollments','value',count(*) filter(where status='completed'),'detail','Current scope · all enrollment dates'),
   jsonb_build_object('label','Completion share','value',round(100.0*(count(*) filter(where status='completed'))/nullif(count(*),0),1),'unit','percent','detail','Completed ÷ all enrollments; no enrollments = unavailable')
  ) into v_kpis from enrollments;
  with attempts as (
   select s.review_status from public.course_submissions s join public.courses c on c.id=s.course_id where s.created_at>=v_start and s.created_at<=v_now
    and (p_target is null or c.id=p_target) and (p_scope='learning' and s.learner_id=v_user or p_scope='teaching' and (v_admin or c.instructor_id=v_user))
   union all
   select s.review_status from public.classroom_assignment_submissions s join public.classroom_assignments a on a.id=s.assignment_id join public.courses c on c.id=a.course_id
    where s.created_at>=v_start and s.created_at<=v_now and (p_target is null or c.id=p_target)
     and (p_scope='learning' and s.learner_id=v_user or p_scope='teaching' and (v_admin or c.instructor_id=v_user))
  ) select jsonb_agg(jsonb_build_object('label',x.label,'value',(select count(*) from attempts a where a.review_status=x.status)) order by x.ord) into v_rows
   from(values('submitted','Awaiting feedback',1),('revision_requested','Revision requested',2),('accepted','Accepted',3))x(status,label,ord);
  v_charts:=jsonb_build_array(jsonb_build_object('id','learning-attempts','title','Submission attempts created in this period','kind','bar','rows',v_rows));
  select jsonb_agg(jsonb_build_object('label',d::date,'value',coalesce(a.n,0)) order by d) into v_series
   from generate_series(v_first::timestamp,(v_now at time zone 'UTC')::date::timestamp,interval '1 day') d
   left join(select (s.completed_at at time zone 'UTC')::date as activity_date,count(*) n from public.course_completions s join public.courses c on c.id=s.course_id
    where s.completed_at>=v_start and s.completed_at<=v_now and (p_target is null or c.id=p_target)
    and (p_scope='learning' and s.learner_id=v_user or p_scope='teaching' and (v_admin or c.instructor_id=v_user)) group by 1)a on a.activity_date=d::date;
  v_notes:=array['Enrollment cards include all dates. Charts use the selected period. Teachers see workshops they instruct; administrators can see all teaching records.','Submission bars count attempts, including resubmissions, across classwork and practical course projects. Each attempt is grouped by its current review status; this is not a count of distinct students.'];

 elsif p_scope='inventory' then
  v_title:='Inventory overview';
  select jsonb_build_array(
   jsonb_build_object('label','Stock records','value',count(*),'detail','Item types, not summed quantities'),
   jsonb_build_object('label','Low stock','value',count(*) filter(where condition='good' and quantity_available<=reorder_level),'detail','Usable item types at or below reorder level'),
   jsonb_build_object('label','Checked out','value',count(*) filter(where quantity_available<quantity_total),'detail','Item types with outstanding quantities'),
   jsonb_build_object('label','Needs repair','value',count(*) filter(where condition='needs_repair'),'detail','Current item types requiring attention')
  ) into v_kpis from public.inventory_items;
  select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value) order by value desc,label),'[]') into v_rows
   from(select item_type label,count(*) value from public.inventory_items group by item_type)s;
  v_charts:=jsonb_build_array(jsonb_build_object('id','inventory-types','title','Current stock records by item type','kind','bar','rows',v_rows));
  v_notes:=array['Inventory is a current snapshot. Quantities measured in different units are never added together. Low stock, checked-out and repair counts can overlap.'];

 elsif p_scope='finance' then
  v_title:='Approved finance activity';
  with approved as materialized(select e.* from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved'
   where e.occurred_on>=v_first and e.occurred_on<=(v_now at time zone 'UTC')::date)
  select jsonb_build_array(
   jsonb_build_object('label','Approved income','value',coalesce(sum(amount) filter(where entry_type='income'),0),'unit','GHS','detail','Transaction dates in the selected period'),
   jsonb_build_object('label','Approved expenses','value',coalesce(sum(amount) filter(where entry_type='expense'),0),'unit','GHS','detail','Transaction dates in the selected period'),
   jsonb_build_object('label','Net movement','value',coalesce(sum(case when entry_type='income' then amount else -amount end),0),'unit','GHS','detail','Period income minus expenses · not closing balance'),
   jsonb_build_object('label','Approved transactions','value',count(*),'detail','Transaction dates in the selected period')
  ) into v_kpis from approved;
  select jsonb_agg(jsonb_build_object('label',x.label,'value',coalesce((select sum(e.amount) from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved'
    where e.entry_type=x.kind and e.occurred_on>=v_first and e.occurred_on<=(v_now at time zone 'UTC')::date),0)) order by x.ord) into v_rows
   from(values('income','Income',1),('expense','Expenses',2)) x(kind,label,ord);
  v_charts:=jsonb_build_array(jsonb_build_object('id','finance-flows','title','Approved income and expenses','kind','bar','unit','GHS','rows',v_rows));
  v_notes:=array['Only administrator-approved ledger entries are included. Dates are transaction dates, not approval dates. Net movement excludes the opening balance.','Shop payment totals are not added to ledger income here; that would count linked sales twice. Monthly reports and closing balances remain on the finance page.'];

 elsif p_scope='orders' then
  v_title:=case when v_admin then 'Shop operations' else 'My order activity' end;
  if to_regclass('public.space_shop_orders') is null then raise exception 'Shop setup required'; end if;
  with orders as materialized(select * from public.space_shop_orders where (v_admin or buyer_id=v_user) and created_at>=v_start and created_at<=v_now)
  select jsonb_build_array(
   jsonb_build_object('label','Orders placed','value',count(*),'detail','Orders created in the selected period'),
   jsonb_build_object('label','In progress','value',count(*) filter(where status in ('pending','confirmed','ready')),'detail','Selected order cohort · current status'),
   jsonb_build_object('label','Delivered','value',count(*) filter(where status='collected'),'detail','Selected order cohort · current status'),
   jsonb_build_object('label',case when v_admin then 'Paid order value' else 'Paid purchases' end,'value',coalesce(sum(total_cents) filter(where payment_status='paid' and status<>'cancelled'),0)/100.0,'unit','GHS','detail','Selected order cohort · confirmed paid · excludes cancellations')
  ) into v_kpis from orders;
  select jsonb_agg(jsonb_build_object('label',x.label,'value',(select count(*) from public.space_shop_orders o where (v_admin or o.buyer_id=v_user) and o.created_at>=v_start and o.created_at<=v_now and o.status=x.status)) order by x.ord) into v_rows
   from(values('pending','Pending',1),('confirmed','Processing',2),('ready','Ready',3),('collected','Delivered',4),('cancelled','Cancelled',5))x(status,label,ord);
  v_charts:=jsonb_build_array(jsonb_build_object('id','order-status','title','Current status of orders placed in this period','kind','bar','rows',v_rows));
  select jsonb_agg(jsonb_build_object('label',d::date,'value',coalesce(a.n,0)) order by d) into v_series
   from generate_series(v_first::timestamp,(v_now at time zone 'UTC')::date::timestamp,interval '1 day') d
   left join(select (created_at at time zone 'UTC')::date as activity_date,count(*) n from public.space_shop_orders where (v_admin or buyer_id=v_user) and created_at>=v_start and created_at<=v_now group by 1)a on a.activity_date=d::date;
  v_notes:=array['Members see only their purchases. Administrators see all orders. Order dates define the cohort; statuses and payment flags describe its current state.','Paid order value is not a revenue-by-payment-date measure or an accounting balance. Store records retain Processing and Delivered as confirmed and collected internally.'];

 elsif p_scope='dm' then
  v_title:=case when p_target is null then 'My messaging activity' else 'Conversation insights' end;
  with messages as materialized(
   select m.*,case when m.sender_id=v_user then m.recipient_id else m.sender_id end peer
   from public.direct_messages m where (m.sender_id=v_user or m.recipient_id=v_user)
    and (p_target is null or m.sender_id=p_target or m.recipient_id=p_target) and m.created_at>=v_start and m.created_at<=v_now
  ), ordered as (
   select m.*,lag(sender_id) over(partition by peer order by created_at,id) prior_sender,
    lag(created_at) over(partition by peer order by created_at,id) prior_at from messages m
  ) select jsonb_build_array(
   jsonb_build_object('label','Sent','value',count(*) filter(where sender_id=v_user),'detail','Messages in the selected period'),
   jsonb_build_object('label','Received','value',count(*) filter(where recipient_id=v_user),'detail','Messages in the selected period'),
   jsonb_build_object('label','Unread in period','value',count(*) filter(where recipient_id=v_user and not exists(select 1 from public.direct_message_reads r where r.user_id=v_user and r.peer_id=ordered.sender_id and r.last_read_at>=ordered.created_at)),'detail','Uses your own saved read position'),
   jsonb_build_object('label','My median reply gap','value',percentile_cont(0.5) within group(order by extract(epoch from(created_at-prior_at))) filter(where sender_id=v_user and prior_sender<>v_user),'unit','seconds','detail','Time from previous incoming message to your reply; overnight time included')
  ) into v_kpis from ordered;
  select jsonb_agg(jsonb_build_object('label',d::date,'value',coalesce(a.n,0)) order by d) into v_series
   from generate_series(v_first::timestamp,(v_now at time zone 'UTC')::date::timestamp,interval '1 day') d
   left join(select (created_at at time zone 'UTC')::date as activity_date,count(*) n from public.direct_messages m where (sender_id=v_user or recipient_id=v_user)
    and (p_target is null or sender_id=p_target or recipient_id=p_target) and created_at>=v_start and created_at<=v_now group by 1)a on a.activity_date=d::date;
  select jsonb_build_array(jsonb_build_object('label','Sent','value',(v_kpis->0->'value')),jsonb_build_object('label','Received','value',(v_kpis->1->'value'))) into v_rows;
  v_charts:=jsonb_build_array(jsonb_build_object('id','dm-direction','title','Messages in this period','kind','bar','rows',v_rows));
  v_notes:=array['Only conversations you participate in are included, even for administrators. Message text, documents, names and other members’ read positions are not returned.','Reply gap measures a change of sender within each conversation. Both messages must fall in this period. It includes time away and is not a service target; no qualifying replies = unavailable. Unread in period may differ from the all-time inbox badge.'];

 elsif p_scope='channel' then
  v_title:='Channel insights';
  select jsonb_build_array(
   jsonb_build_object('label','Messages','value',count(*),'detail','Visible, non-deleted messages in this period'),
   jsonb_build_object('label','Participants','value',count(distinct author_id),'detail','Distinct authors in this period'),
   jsonb_build_object('label','Thread replies','value',count(*) filter(where parent_id is not null),'detail','Replies are included in the message total'),
   jsonb_build_object('label','Images shared','value',count(*) filter(where image_path is not null),'detail','Messages with an image in this period')
  ) into v_kpis from public.channel_messages where channel_id=p_target and deleted_at is null and created_at>=v_start and created_at<=v_now;
  select jsonb_agg(jsonb_build_object('label',d::date,'value',coalesce(a.n,0)) order by d) into v_series
   from generate_series(v_first::timestamp,(v_now at time zone 'UTC')::date::timestamp,interval '1 day') d
   left join(select (created_at at time zone 'UTC')::date as activity_date,count(*) n from public.channel_messages where channel_id=p_target and deleted_at is null and created_at>=v_start and created_at<=v_now group by 1)a on a.activity_date=d::date;
  select jsonb_build_array(jsonb_build_object('label','New threads','value',count(*) filter(where parent_id is null)),jsonb_build_object('label','Replies','value',count(*) filter(where parent_id is not null))) into v_rows
   from public.channel_messages where channel_id=p_target and deleted_at is null and created_at>=v_start and created_at<=v_now;
  v_charts:=jsonb_build_array(jsonb_build_object('id','channel-threads','title','Threads and replies in this period','kind','bar','rows',v_rows));
  v_notes:=array['Only the selected channel is counted, under your existing channel permissions. Deleted messages are excluded. Participants counts distinct authors, not people currently online.'];
 end if;

 if jsonb_array_length(v_series)>0 then
  v_charts:=v_charts||jsonb_build_array(jsonb_build_object('id',p_scope||'-daily','title',case p_scope when 'membership' then 'Accounts created each day' when 'orders' then 'Orders placed each day' when 'learning' then 'Workshop completions each day' when 'teaching' then 'Workshop completions each day' else 'Messages each day' end,'kind','daily','rows',v_series));
 end if;
 return jsonb_build_object('scope',p_scope,'title',v_title,'generated_at',v_now,'from',v_first,'through',(v_now at time zone 'UTC')::date,'timezone','UTC','days',p_days,'kpis',v_kpis,'charts',v_charts,'notes',to_jsonb(v_notes));
end;
$metrics$;
revoke all on function public.space_metrics(text,integer,uuid) from public,anon;
grant execute on function public.space_metrics(text,integer,uuid) to authenticated;
comment on function public.space_metrics(text,integer,uuid) is 'Read-only role-scoped SPACE metrics. SECURITY INVOKER preserves RLS. UTC calendar windows include today; snapshot cards say so explicitly.';
commit;
