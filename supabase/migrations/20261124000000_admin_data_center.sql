-- Run after SPACE security hardening and the existing club feature migrations.
-- Does not copy message bodies, credentials, private content, or uploaded bytes.
begin;

create schema if not exists space_private;
revoke all on schema space_private from public,anon,authenticated;

create table if not exists space_private.data_center_sources(
  dataset text primary key,
  area text not null,
  title text not null,
  key_col text,
  time_col text,
  columns text[] not null,
  state_columns text[] not null
);
create table if not exists space_private.data_center_events(
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default statement_timestamp(),
  dataset text not null,
  action text not null,
  record_id uuid,
  actor_id uuid,
  changed_fields text[],
  before_state jsonb,
  after_state jsonb
);
create index if not exists data_center_events_time on space_private.data_center_events(happened_at,id);
create index if not exists data_center_events_source_time on space_private.data_center_events(dataset,happened_at,id);
create table if not exists space_private.data_center_daily(
  day date not null,
  dataset text not null,
  action text not null,
  shard smallint not null check(shard between 0 and 31),
  total bigint not null check(total>0),
  primary key(day,dataset,action,shard)
);
create table if not exists space_private.data_center_settings(
  singleton boolean primary key default true check(singleton),
  started_at timestamptz not null default statement_timestamp()
);
insert into space_private.data_center_settings(singleton) values(true) on conflict do nothing;
revoke all on space_private.data_center_sources,space_private.data_center_events,space_private.data_center_daily,
  space_private.data_center_settings from public,anon,authenticated,service_role;

insert into space_private.data_center_sources(dataset,area,title,key_col,time_col,columns,state_columns) values
  ('profiles','Membership','Members and applications','id','created_at',array['full_name','programme','role','membership_status','application_type','profile_visibility','founder_teaching_enabled']::text[],array['role','membership_status','application_type','profile_visibility','founder_teaching_enabled']::text[]),
  ('member_learning_paths','Learning','Member learning tracks','user_id','created_at',array['tracks','updated_at']::text[],array['tracks']::text[]),
  ('courses','Learning','Courses and workshops','id','created_at',array['title','category','level','starts_at','instructor_id','submission_due_at','status']::text[],array['status','starts_at','submission_due_at']::text[]),
  ('course_enrollments','Learning','Course enrollments','id','created_at',array['course_id','learner_id','status','completed_at']::text[],array['status','completed_at']::text[]),
  ('learning_materials','Learning','Learning materials','id','created_at',array['course_id','learning_track','uploaded_by','title','kind','file_size','hidden_at']::text[],array['kind','file_size','hidden_at']::text[]),
  ('classroom_assignments','Learning','Classroom assignments','id','created_at',array['course_id','title','kind','due_at','learner_id','created_by']::text[],array['kind','due_at']::text[]),
  ('classroom_assignment_submissions','Learning','Classroom submissions','id','created_at',array['assignment_id','learner_id','review_status','seen_at','reviewed_at']::text[],array['review_status','seen_at','reviewed_at']::text[]),
  ('course_submissions','Learning','Course submissions','id','created_at',array['course_id','learner_id','review_status','seen_at','reviewed_at']::text[],array['review_status','seen_at','reviewed_at']::text[]),
  ('course_completions','Learning','Course completions','id','created_at',array['course_id','learner_id','completed_at','completion_kind']::text[],array['completion_kind','completed_at']::text[]),
  ('space_course_lessons','Learning','Course lessons','id','created_at',array['course_id','title','position']::text[],array['position']::text[]),
  ('space_lesson_checkins','Learning','Lesson progress','id','created_at',array['lesson_id','learner_id','done']::text[],array['done']::text[]),
  ('space_class_sessions','Learning','Class sessions','id','created_at',array['course_id','title','starts_at','ends_at']::text[],array['starts_at','ends_at']::text[]),
  ('space_class_attendance','Learning','Class attendance','id','created_at',array['session_id','learner_id','status']::text[],array['status']::text[]),
  ('space_practical_grades','Learning','Practical grades','id','created_at',array['submission_id','course_id','learner_id','demonstration','testing','explanation','graded_by']::text[],array['demonstration','testing','explanation']::text[]),
  ('space_certificates','Learning','Certificates','id','created_at',array['course_id','learner_id','issued_at','revoked_at','completion_kind','template_version']::text[],array['revoked_at','completion_kind','template_version']::text[]),
  ('space_chapters','Chapters','University chapters','id','created_at',array['name','institution','status']::text[],array['status']::text[]),
  ('space_chapter_memberships','Chapters','Chapter memberships','id','requested_at',array['chapter_id','user_id','role','status','updated_at']::text[],array['role','status']::text[]),
  ('space_chapter_activities','Chapters','Chapter activities','id','created_at',array['chapter_id','kind','title','starts_at','track','archived_at']::text[],array['kind','starts_at','track','archived_at']::text[]),
  ('space_chapter_office_assignments','Chapters','Chapter office assignments','id','assigned_at',array['chapter_id','user_id','office','assigned_by','revoked_at']::text[],array['office','revoked_at']::text[]),
  ('space_chapter_office_tasks','Chapters','Chapter office tasks','id','created_at',array['chapter_id','office','assignee_id','title','due_on','status','completed_at']::text[],array['office','due_on','status','completed_at']::text[]),
  ('projects','Projects','Projects','id','created_at',array['owner_id','title','status','progress']::text[],array['status','progress']::text[]),
  ('project_tasks','Projects','Project tasks','id','created_at',array['project_id','title','status','due_at','assignee_id','milestone_id']::text[],array['status','due_at','assignee_id']::text[]),
  ('project_milestones','Projects','Project milestones','id','created_at',array['project_id','title','due_at','status']::text[],array['status','due_at']::text[]),
  ('space_project_updates','Projects','Project updates','id','created_at',array['project_id','author_id','document_id']::text[],array[]::text[]),
  ('events','Events and meetings','Events','id','created_at',array['title','starts_at','ends_at']::text[],array['starts_at','ends_at']::text[]),
  ('space_event_settings','Events and meetings','Event settings','id','created_at',array['event_id','capacity']::text[],array['capacity']::text[]),
  ('space_event_registrations','Events and meetings','Event registrations','id','created_at',array['event_id','user_id','status','checked_in','checked_in_at']::text[],array['status','checked_in','checked_in_at']::text[]),
  ('space_event_feedback','Events and meetings','Event rating records','id','created_at',array['event_id','rating']::text[],array['rating']::text[]),
  ('space_meetings','Events and meetings','Meetings','id','created_at',array['title','starts_at','status','created_by']::text[],array['starts_at','status']::text[]),
  ('space_meeting_attendance','Events and meetings','Meeting attendance','id','created_at',array['meeting_id','user_id','status']::text[],array['status']::text[]),
  ('space_meeting_actions','Events and meetings','Meeting actions','id','created_at',array['meeting_id','assignee_id','title','due_at','status']::text[],array['due_at','status']::text[]),
  ('founder_meetings','Events and meetings','Founder meetings','id','created_at',array['host_id','title','starts_at','ends_at']::text[],array['starts_at','ends_at']::text[]),
  ('activity_posts','Community','Community posts metadata','id','created_at',array['title','category','edited_at','deleted_at']::text[],array['category','edited_at','deleted_at']::text[]),
  ('topics','Community','Forum topic metadata','id','created_at',array['project_id','title','category']::text[],array['category']::text[]),
  ('channels','Community','Channel directory','id','created_at',array['slug','name']::text[],array['slug']::text[]),
  ('documents','Community','Shared document metadata','id','created_at',array['channel_id','title','file_type','file_size','hidden_at']::text[],array['file_size','hidden_at']::text[]),
  ('document_versions','Community','Shared file versions','id','created_at',array['document_id','uploaded_by','file_size']::text[],array['file_size']::text[]),
  ('news_posts','Community','Technology news','id','created_at',array['title','category','status']::text[],array['category','status']::text[]),
  ('announcements','Community','Announcements','id','created_at',array['title','priority']::text[],array['priority']::text[]),
  ('officer_assignments','Operations','Officer assignments','id','created_at',array['user_id','position','assigned_by','revoked_at']::text[],array['revoked_at']::text[]),
  ('officer_work_items','Operations','Officer work items','id','created_at',array['assignee_id','position','kind','title','status','due_at']::text[],array['position','kind','status','due_at']::text[]),
  ('space_manual_metrics','Operations','Manually recorded metrics','id','created_at',array['scope','course_id','label','unit','actual','target','observed_on','revision']::text[],array['actual','target','observed_on','revision']::text[]),
  ('space_map_places','Operations','Map places metadata','id','updated_at',array['title','kind','starts_at']::text[],array['kind','starts_at']::text[]),
  ('inventory_items','Inventory','Inventory records','id','created_at',array['name','category','quantity_total','quantity_available','condition','item_type','unit','reorder_level']::text[],array['quantity_total','quantity_available','condition','item_type','unit','reorder_level']::text[]),
  ('inventory_movements','Inventory','Inventory movements','id','created_at',array['item_id','kind','quantity','handled_by','unit_at_movement']::text[],array['kind','quantity','unit_at_movement']::text[]),
  ('finance_entries','Finance','Finance entries','id','created_at',array['entry_type','category','amount','occurred_on','voucher_number','approval_required']::text[],array['entry_type','category','amount','occurred_on','approval_required']::text[]),
  ('finance_reviews','Finance','Finance approvals','id','created_at',array['entry_id','decision','reviewer_id']::text[],array['decision']::text[]),
  ('finance_monthly_reviews','Finance','Monthly finance reviews','id','created_at',array['month','opening_balance','income','expense','closing_balance','actual_balance','difference','approved_count','rejected_count']::text[],array['approved_count','rejected_count']::text[]),
  ('finance_receipts','Finance','Finance receipt metadata','id','created_at',array['entry_id','file_size','mime_type','uploaded_by']::text[],array[]::text[]),
  ('space_finance_followups','Finance','Finance follow-ups','id','created_at',array['review_id','status','created_by']::text[],array['status']::text[]),
  ('space_shop_products','Shop','Shop products','id','created_at',array['title','category','published','archived']::text[],array['published','archived']::text[]),
  ('space_shop_variants','Shop','Shop stock and variants','id','created_at',array['product_id','sku','label','price_cents','unit','on_hand','reserved','available','low_stock','active']::text[],array['price_cents','on_hand','reserved','low_stock','active']::text[]),
  ('space_shop_orders','Shop','Shop orders','id','created_at',array['order_ref','buyer_id','status','total_cents','currency','payment_status','finance_entry_id','collected_at']::text[],array['status','payment_status','collected_at']::text[]),
  ('space_shop_order_items','Shop','Order line items','id',null,array['order_id','variant_id','product_title','variant_label','sku','unit','quantity','unit_price_cents','line_total_cents']::text[],array['quantity','unit_price_cents']::text[]),
  ('space_shop_stock_moves','Shop','Shop stock movements','id','created_at',array['variant_id','order_id','kind','stock_delta','reserved_delta','on_hand_after','reserved_after']::text[],array['kind','stock_delta','reserved_delta']::text[]),
  ('space_shop_receipts','Shop','Shop receipt metadata','id','issued_at',array['order_id','receipt_number','total_cents','currency','paid_at']::text[],array['paid_at']::text[]),
  ('investor_inquiries','Partners','Investor inquiry status','id','created_at',array['investor_id','status']::text[],array['status']::text[]),
  ('investor_updates','Partners','Investor updates','id','created_at',array['title','category','published','published_at']::text[],array['category','published','published_at']::text[]),
  ('reports','Governance','Moderation case status','id','created_at',array['target_type','target_id','status']::text[],array['status']::text[]),
  ('privacy_requests','Governance','Privacy request status','id','created_at',array['request_type','status','reviewed_at']::text[],array['request_type','status','reviewed_at']::text[]),
  ('audit_events','Governance','Existing administrator audit records','id','created_at',array['actor_id','action','target_type','target_id']::text[],array[]::text[]),
  ('approval_email_outbox','Operations','Approval delivery status','id','created_at',array['status','attempts','sent_at']::text[],array['status','attempts','sent_at']::text[]),
  ('push_outbox','Operations','Push delivery (counts)',null,null,array[]::text[],array[]::text[]),
  ('notifications','Operations','Notifications (counts)',null,null,array[]::text[],array[]::text[]),
  ('direct_messages','Community','Direct messages (counts)',null,null,array[]::text[],array[]::text[]),
  ('channel_messages','Community','Team chat (counts)',null,null,array[]::text[],array[]::text[]),
  ('activity_comments','Community','Feed comments (counts)',null,null,array[]::text[],array[]::text[]),
  ('activity_likes','Community','Feed reactions (counts)',null,null,array[]::text[],array[]::text[]),
  ('message_reactions','Community','Team chat reactions (counts)',null,null,array[]::text[],array[]::text[]),
  ('direct_message_reactions','Community','DM reactions (counts)',null,null,array[]::text[],array[]::text[]),
  ('replies','Community','Forum replies (counts)',null,null,array[]::text[],array[]::text[]),
  ('project_members','Projects','Project participation (counts)',null,null,array[]::text[],array[]::text[]),
  ('space_location_shares','Operations','Location share starts and ends (counts)',null,null,array[]::text[],array[]::text[]),
  ('space_avatar_looks','Operations','Avatar looks (counts)',null,null,array[]::text[],array[]::text[]),
  ('event_rsvps','Events and meetings','Event RSVPs (counts)',null,null,array[]::text[],array[]::text[]),
  ('founder_meeting_rsvps','Events and meetings','Founder meeting RSVPs (counts)',null,null,array[]::text[],array[]::text[]),
  ('teaching_track_assignments','Learning','Track assignment changes (counts)',null,null,array[]::text[],array[]::text[])
on conflict(dataset) do update set area=excluded.area,title=excluded.title,key_col=excluded.key_col,
  time_col=excluded.time_col,columns=excluded.columns,state_columns=excluded.state_columns;

-- The trigger stores only approved lifecycle fields. High-volume and private
-- surfaces contribute sharded daily counters, without record or actor IDs.
create or replace function space_private.data_center_capture()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_key text:=tg_argv[0];
  v_operation text:=lower(tg_op);
  v_old jsonb;
  v_new jsonb;
  v_before jsonb;
  v_after jsonb;
  v_state text[]:=string_to_array(tg_argv[1],',');
  v_fields text[]:=string_to_array(tg_argv[2],',');
  v_changed text[];
begin
  if tg_op<>'INSERT' then
    v_old:=to_jsonb(old);
    select coalesce(jsonb_object_agg(k,v_old->k),'{}'::jsonb) into v_before from unnest(v_state) k;
  end if;
  if tg_op<>'DELETE' then
    v_new:=to_jsonb(new);
    select coalesce(jsonb_object_agg(k,v_new->k),'{}'::jsonb) into v_after from unnest(v_state) k;
  end if;
  if tg_op='UPDATE' then
    select array_agg(k order by k) into v_changed
    from (select distinct k from unnest(v_fields||v_state) k where k<>'updated_at') cols
    where v_old->k is distinct from v_new->k;
    if v_changed is null then return null; end if;
  end if;
  insert into space_private.data_center_events(dataset,action,record_id,actor_id,changed_fields,before_state,after_state)
  values(tg_table_name,v_operation,coalesce(v_new->>v_key,v_old->>v_key)::uuid,auth.uid(),v_changed,v_before,v_after);
  return null;
end;
$$;
revoke all on function space_private.data_center_capture() from public,anon,authenticated,service_role;

create or replace function space_private.data_center_count_statement()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_count bigint;
begin
  select count(*) into v_count from space_dc_changed_rows;
  if v_count>0 then
    insert into space_private.data_center_daily(day,dataset,action,shard,total)
    values ((statement_timestamp() at time zone 'UTC')::date,tg_table_name,lower(tg_op),
      mod(pg_current_xact_id()::text::bigint,32)::smallint,v_count)
    on conflict(day,dataset,action,shard) do update
    set total=space_private.data_center_daily.total+excluded.total;
  end if;
  return null;
end;
$$;
revoke all on function space_private.data_center_count_statement() from public,anon,authenticated,service_role;

do $$
declare s space_private.data_center_sources;
  rel regclass;
  col text;
  monitored text;
begin
  for s in select * from space_private.data_center_sources order by dataset loop
    rel:=to_regclass(format('public.%I',s.dataset));
    if rel is null then continue; end if;
    for col in select distinct x from unnest(array[s.key_col,s.time_col]||s.columns||s.state_columns) x where x is not null loop
      if not exists(select 1 from pg_catalog.pg_attribute where attrelid=rel and attname=col and attnum>0 and not attisdropped)
      then raise exception 'Finish the SPACE migrations before Data Center: %.% is missing',s.dataset,col; end if;
    end loop;
    execute format('drop trigger if exists space_capture_data_center on %s',rel);
    execute format('drop trigger if exists space_capture_data_center_update on %s',rel);
    execute format('drop trigger if exists space_data_center_count_insert on %s',rel);
    execute format('drop trigger if exists space_data_center_count_update on %s',rel);
    execute format('drop trigger if exists space_data_center_count_delete on %s',rel);
    if s.key_col is null then
      execute format('create trigger space_data_center_count_insert after insert on %s referencing new table as space_dc_changed_rows for each statement execute function space_private.data_center_count_statement()',rel);
      if s.dataset<>'space_location_shares' then
        execute format('create trigger space_data_center_count_update after update on %s referencing new table as space_dc_changed_rows for each statement execute function space_private.data_center_count_statement()',rel);
      end if;
      execute format('create trigger space_data_center_count_delete after delete on %s referencing old table as space_dc_changed_rows for each statement execute function space_private.data_center_count_statement()',rel);
    else
      execute format('create trigger space_capture_data_center after insert or delete on %s for each row execute function space_private.data_center_capture(%L,%L,%L)',
        rel,s.key_col,array_to_string(s.state_columns,','),array_to_string(s.columns,','));
      select string_agg(format('%I',name),',' order by name) into monitored
      from (select distinct name from unnest(s.state_columns||s.columns) name where name<>'updated_at') selected;
      if monitored is not null then
        execute format('create trigger space_capture_data_center_update after update of %s on %s for each row execute function space_private.data_center_capture(%L,%L,%L)',
          monitored,rel,s.key_col,array_to_string(s.state_columns,','),array_to_string(s.columns,','));
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.space_data_center_catalog()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_catalog jsonb;
begin
  perform public.space_require_admin_mfa();
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.dataset,'area',s.area,'title',s.title,'records',s.key_col is not null,
    'has_date',s.time_col is not null,'columns',
      case when s.key_col is null then array[]::text[]
        else array_remove(array[s.key_col,s.time_col],null)||s.columns end)
    order by s.area,s.title),'[]'::jsonb) into v_catalog
  from space_private.data_center_sources s
  where to_regclass(format('public.%I',s.dataset)) is not null;
  return jsonb_build_object('datasets',v_catalog,'started_at',
    (select started_at from space_private.data_center_settings where singleton));
end;
$$;

-- Cursor pages use a fixed UTC time ceiling. Only names in the server-owned
-- catalog can enter dynamic SQL; all request values use bound parameters.
create or replace function public.space_data_center_page(
  p_mode text,p_dataset text,p_from date,p_to date,p_cursor jsonb default null,
  p_limit integer default 75,p_export boolean default false
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  s space_private.data_center_sources;
  v_dataset text:=nullif(p_dataset,'');
  v_limit integer:=least(200,greatest(1,coalesce(p_limit,75)));
  v_cutoff timestamptz;
  v_start timestamptz;
  v_stop timestamptz;
  v_from date;
  v_to date;
  v_today date:=(statement_timestamp() at time zone 'UTC')::date;
  v_at timestamptz;
  v_uuid uuid;
  v_id bigint;
  v_offset_day date;
  v_row record;
  v_columns text[];
  v_sql text;
  v_select text;
  v_count integer:=0;
  v_items jsonb:='[]'::jsonb;
  v_next jsonb;
  v_last jsonb;
begin
  perform public.space_require_admin_mfa();
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform public.space_require_recent_admin_mfa();
  if p_mode is null or p_mode not in ('records','history','totals') then raise exception 'Choose a Data Center view'; end if;
  if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or p_cursor->>'cutoff' is null
    or p_cursor->>'mode' is distinct from p_mode or p_cursor->>'dataset' is distinct from v_dataset
    or p_cursor->>'from' is distinct from p_from::text or p_cursor->>'to' is distinct from p_to::text
    or (p_cursor->>'export')::boolean is distinct from coalesce(p_export,false)) then
    raise exception 'This cursor does not match your filters. Load the first page.';
  end if;
  if p_from is null or p_to is null or p_from < date '2000-01-01' or p_to>v_today
    or p_to<p_from or p_to-p_from>365 then
    raise exception 'Choose a valid UTC date range of up to 366 days, ending no later than today.';
  end if;
  v_cutoff:=least(statement_timestamp(),coalesce((p_cursor->>'cutoff')::timestamptz,statement_timestamp()));
  v_start:=p_from::timestamp at time zone 'UTC';
  v_stop:=least(v_cutoff,(p_to+1)::timestamp at time zone 'UTC');
  v_from:=p_from;
  v_to:=least(p_to,(v_cutoff at time zone 'UTC')::date-1);
  if v_dataset is not null then
    select * into s from space_private.data_center_sources src where src.dataset=v_dataset
      and to_regclass(format('public.%I',src.dataset)) is not null;
    if not found then raise exception 'Dataset unavailable'; end if;
  end if;

  if p_mode='records' then
    if v_dataset is null or s.key_col is null then raise exception 'Choose a dataset with detailed records'; end if;
    v_columns:=array_remove(array[s.key_col,s.time_col],null)||s.columns;
    select string_agg(format('t.%I',c),',') into v_select from unnest(v_columns) c;
    v_at:=(p_cursor->>'at')::timestamptz;
    v_uuid:=(p_cursor->>'id')::uuid;
    if s.time_col is null then
      v_sql:=format('select t.%I::text as id,null::timestamptz as at,to_jsonb(t) as obj
        from (select %s from public.%I t where ($1::timestamptz is not null and $2::timestamptz is not null)
        and ($3::timestamptz is null or $3 is not null) and ($4::uuid is null or t.%I<$4)
        order by t.%I desc limit $5) t order by t.%I desc',s.key_col,v_select,s.dataset,s.key_col,s.key_col,s.key_col);
    else
      v_sql:=format('select t.%I::text as id,t.%I as at,to_jsonb(t) as obj
        from (select %s from public.%I t where t.%I >= $1 and t.%I < $2
        and ($3::timestamptz is null or (t.%I,t.%I)<($3,$4::uuid))
        order by t.%I desc,t.%I desc limit $5) t order by t.%I desc,t.%I desc',
        s.key_col,s.time_col,v_select,s.dataset,s.time_col,s.time_col,s.time_col,s.key_col,
        s.time_col,s.key_col,s.time_col,s.key_col);
    end if;
    for v_row in execute v_sql using v_start,v_stop,v_at,v_uuid,v_limit+1 loop
      if v_count=v_limit then v_next:=v_last;exit;end if;
      v_items:=v_items||jsonb_build_array(v_row.obj); v_count:=v_count+1;
      v_last:=jsonb_build_object('id',v_row.id,'at',v_row.at);
    end loop;
  elsif p_mode='history' then
    v_columns:=array['happened_at','dataset','action','record_id','actor_id','changed_fields','before_state','after_state'];
    v_at:=(p_cursor->>'at')::timestamptz;
    v_id:=(p_cursor->>'id')::bigint;
    for v_row in
      select e.id,e.happened_at,e.dataset,e.action,e.record_id,e.actor_id,e.changed_fields,e.before_state,e.after_state
      from space_private.data_center_events e where e.happened_at>=v_start and e.happened_at<v_stop
        and (v_dataset is null or e.dataset=v_dataset)
        and (v_at is null or (e.happened_at,e.id)<(v_at,v_id))
      order by e.happened_at desc,e.id desc limit v_limit+1
    loop
      if v_count=v_limit then v_next:=v_last;exit;end if;
      v_items:=v_items||jsonb_build_array(to_jsonb(v_row)-'id'); v_count:=v_count+1;
      v_last:=jsonb_build_object('id',v_row.id::text,'at',v_row.happened_at);
    end loop;
  else
    v_columns:=array['day','area','dataset','operation','total'];
    v_offset_day:=(p_cursor->>'day')::date;
    for v_row in
      with tallies as (
        select (e.happened_at at time zone 'UTC')::date as day,e.dataset,e.action as operation,count(*) as total
        from space_private.data_center_events e join space_private.data_center_sources src on src.dataset=e.dataset
        where e.happened_at>=v_start and e.happened_at<((v_to+1)::timestamp at time zone 'UTC')
          and (v_dataset is null or e.dataset=v_dataset) and (v_offset_day is null or e.happened_at<((v_offset_day+1)::timestamp at time zone 'UTC'))
        group by 1,2,3
        union all
        select d.day,d.dataset,d.action,sum(d.total)::bigint from space_private.data_center_daily d
        where d.day between v_from and v_to and (v_dataset is null or d.dataset=v_dataset)
          and (v_offset_day is null or d.day<=v_offset_day)
        group by 1,2,3
      )
      select t.day,c.area,t.dataset,t.operation,sum(t.total)::bigint as total
      from tallies t join space_private.data_center_sources c on c.dataset=t.dataset
      where v_offset_day is null or (t.day,t.dataset,t.operation)<(v_offset_day,p_cursor->>'source',p_cursor->>'operation')
      group by 1,2,3,4 order by t.day desc,t.dataset desc,t.operation desc limit v_limit+1
    loop
      if v_count=v_limit then v_next:=v_last;exit;end if;
      v_items:=v_items||jsonb_build_array(to_jsonb(v_row)); v_count:=v_count+1;
      v_last:=jsonb_build_object('day',v_row.day,'source',v_row.dataset,'operation',v_row.operation);
    end loop;
  end if;
  if p_cursor is null then
    insert into space_private.data_center_events(dataset,action,actor_id,after_state)
      values('data_center',case when coalesce(p_export,false) then 'export_requested' else 'view_requested' end,
      auth.uid(),jsonb_build_object('view',p_mode,'dataset',v_dataset,'from',p_from,'to',p_to));
  end if;
  if v_next is not null then
    v_next:=v_next||jsonb_build_object('cutoff',v_cutoff,'mode',p_mode,'dataset',v_dataset,
      'from',p_from,'to',p_to,'export',coalesce(p_export,false));
  end if;
  return jsonb_build_object('rows',v_items,'columns',v_columns,'next_cursor',v_next,'as_of',v_cutoff);
end;
$$;
revoke all on function public.space_data_center_catalog() from public,anon,authenticated,service_role;
revoke all on function public.space_data_center_page(text,text,date,date,jsonb,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.space_data_center_catalog() to authenticated;
grant execute on function public.space_data_center_page(text,text,date,date,jsonb,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
