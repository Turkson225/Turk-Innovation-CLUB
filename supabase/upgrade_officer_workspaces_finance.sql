-- Run the entire file after the learning dashboards and inventory/finance approvals upgrades.
-- Additive officer roles; admin-only ledger control; private receipts; monthly closing.
begin;
do $$ begin
  if to_regclass('public.finance_reviews') is null or to_regclass('public.teaching_track_assignments') is null then
    raise exception 'Run the finance approvals and learning dashboards upgrades first';
  end if;
end $$;

create table if not exists public.officer_assignments(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 position text not null check(position in ('president','vice_president','secretary','treasurer','project_lead','events_coordinator','communications_officer')),
 assigned_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 revoked_at timestamptz,revoked_by uuid references public.profiles(id),note text not null default '' check(length(note)<=1000)
);
create unique index if not exists officer_active_unique on public.officer_assignments(user_id,position) where revoked_at is null;
create index if not exists officer_active_lookup on public.officer_assignments(position,user_id) where revoked_at is null;
create or replace function public.has_officer_role(p_position text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_approved() and exists(select 1 from public.officer_assignments where user_id=auth.uid() and position=p_position and revoked_at is null)
$$;
revoke all on function public.has_officer_role(text) from public,anon;
grant execute on function public.has_officer_role(text) to authenticated;
alter table public.officer_assignments enable row level security;
revoke all on public.officer_assignments from public,anon,authenticated;
grant select on public.officer_assignments to authenticated;
drop policy if exists officer_assignment_read on public.officer_assignments;
create policy officer_assignment_read on public.officer_assignments for select to authenticated using(public.is_admin() or user_id=auth.uid() and public.is_approved() and revoked_at is null);

create or replace function public.set_club_officer_roles(p_user uuid,p_roles text[],p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare v_role text;v_note text:=trim(coalesce(p_note,''));
begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_roles is null or cardinality(p_roles)>7 or cardinality(p_roles)<>(select count(distinct x) from unnest(p_roles) x) or exists(select 1 from unnest(p_roles) x where x is null or x not in ('president','vice_president','secretary','treasurer','project_lead','events_coordinator','communications_officer')) then raise exception 'Select valid, distinct officer roles';end if;
 if length(v_note)<3 or length(v_note)>1000 then raise exception 'Enter a reason for this assignment';end if;
 perform 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_user and p.membership_status='approved' and p.role in ('member','teacher','founder','admin') and u.email_confirmed_at is not null for update of p;
 if not found then raise exception 'Choose a verified, approved club member';end if;
 update public.officer_assignments set revoked_at=now(),revoked_by=auth.uid(),note=v_note where user_id=p_user and revoked_at is null and not(position=any(p_roles));
 foreach v_role in array p_roles loop
  insert into public.officer_assignments(user_id,position,assigned_by,note) values(p_user,v_role,auth.uid(),v_note) on conflict(user_id,position) where revoked_at is null do nothing;
 end loop;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'officer_roles_changed','profile',p_user);
 insert into public.notifications(user_id,kind,title,target_type,target_id) values(p_user,'role','Your club officer responsibilities were updated','officer',p_user);
end $$;
revoke all on function public.set_club_officer_roles(uuid,text[],text) from public,anon;
grant execute on function public.set_club_officer_roles(uuid,text[],text) to authenticated;

create table if not exists public.officer_work_items(
 id uuid primary key default gen_random_uuid(),assignee_id uuid not null references public.profiles(id),position text not null,
 kind text not null check(kind in ('task','minutes','budget_note','event_plan','project_plan','communication')),
 title text not null check(length(trim(title)) between 3 and 160),body text not null default '' check(length(body)<=10000),
 status text not null default 'todo' check(status in ('todo','in_progress','submitted','done')),
 due_at date,feedback text not null default '' check(length(feedback)<=2000),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists officer_work_owner on public.officer_work_items(assignee_id,position,created_at desc);
create table if not exists public.officer_work_events(
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.officer_work_items(id),actor_id uuid not null references public.profiles(id),
 status text not null,title text not null,body text not null,feedback text not null,due_at date,created_at timestamptz not null default now()
);
alter table public.officer_work_items enable row level security;alter table public.officer_work_events enable row level security;
revoke all on public.officer_work_items,public.officer_work_events from public,anon,authenticated;
grant select on public.officer_work_items,public.officer_work_events to authenticated;
drop policy if exists officer_work_read on public.officer_work_items;
create policy officer_work_read on public.officer_work_items for select to authenticated using(public.is_admin() or assignee_id=auth.uid() and public.has_officer_role(position));
drop policy if exists officer_work_event_read on public.officer_work_events;
create policy officer_work_event_read on public.officer_work_events for select to authenticated using(public.is_admin() or exists(select 1 from public.officer_work_items w where w.id=item_id and w.assignee_id=auth.uid() and public.has_officer_role(w.position)));
create or replace function public.save_officer_work(p_item uuid,p_assignee uuid,p_position text,p_kind text,p_title text,p_body text,p_status text,p_due date default null,p_feedback text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare v_old public.officer_work_items%rowtype;v_id uuid;v_admin boolean:=public.is_admin();
begin
 if not public.is_approved() then raise exception 'Approved club access required';end if;
 if not v_admin and p_assignee is distinct from auth.uid() then raise exception 'You can update only your own office work';end if;
 perform 1 from public.officer_assignments a join public.profiles p on p.id=a.user_id where a.user_id=p_assignee and a.position=p_position and a.revoked_at is null and p.membership_status='approved' and p.role<>'investor' for share of a;
 if not found then raise exception 'This officer role is not active';end if;
 if p_kind is null or not(p_kind='task' or p_kind=case p_position when 'secretary' then 'minutes' when 'treasurer' then 'budget_note' when 'events_coordinator' then 'event_plan' when 'communications_officer' then 'communication' else 'project_plan' end) then raise exception 'Select the work type for this office';end if;
 if p_title is null or length(trim(p_title)) not between 3 and 160 or p_body is null or length(trim(p_body)) not between 10 and 10000 then raise exception 'Add a title and at least 10 characters of work notes';end if;
 if p_status is null or p_status not in ('todo','in_progress','submitted','done') or (not v_admin and p_status='done') then raise exception 'Only an administrator can complete a review';end if;
 if length(coalesce(p_feedback,''))>2000 or not v_admin and coalesce(p_feedback,'')<>'' then raise exception 'Administrator review notes required';end if;
 if p_item is not null then
  select * into v_old from public.officer_work_items where id=p_item for update;
  if not found or v_old.assignee_id<>p_assignee or v_old.position<>p_position then raise exception 'Work item is unavailable';end if;
  if v_old.status='done' and not v_admin then raise exception 'Completed records are read only';end if;
  update public.officer_work_items set title=trim(p_title),kind=p_kind,body=trim(p_body),status=p_status,due_at=p_due,feedback=case when v_admin then coalesce(p_feedback,'') else v_old.feedback end,updated_at=now() where id=p_item returning id into v_id;
 else
  insert into public.officer_work_items(assignee_id,position,kind,title,body,status,due_at,feedback,created_by) values(p_assignee,p_position,p_kind,trim(p_title),trim(p_body),p_status,p_due,case when v_admin then coalesce(p_feedback,'') else '' end,auth.uid()) returning id into v_id;
 end if;
 insert into public.officer_work_events(item_id,actor_id,status,title,body,feedback,due_at) select id,auth.uid(),status,title,body,feedback,due_at from public.officer_work_items where id=v_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'officer_work_saved','officer_work',v_id);
 return v_id;
end $$;
revoke all on function public.save_officer_work(uuid,uuid,text,text,text,text,text,date,text) from public,anon;
grant execute on function public.save_officer_work(uuid,uuid,text,text,text,text,text,date,text) to authenticated;

-- Remove earlier founder permissions without changing any historic entries or decisions.
do $$ declare p record;begin
 for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('finance_entries','finance_reviews') loop execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);end loop;
end $$;
create policy finance_admin_read on public.finance_entries for select to authenticated using(public.is_admin());
create policy finance_admin_insert on public.finance_entries for insert to authenticated with check(public.is_admin() and created_by=auth.uid());
create policy finance_reviews_admin_read on public.finance_reviews for select to authenticated using(public.is_admin());
alter table public.finance_entries add column if not exists voucher_number bigint generated by default as identity;
create unique index if not exists finance_voucher_unique on public.finance_entries(voucher_number);
create table if not exists public.finance_receipts(
 id uuid primary key default gen_random_uuid(),entry_id uuid not null references public.finance_entries(id),storage_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 160),file_size bigint not null check(file_size between 1 and 10485760),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 uploaded_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index if not exists finance_receipt_entry on public.finance_receipts(entry_id,created_at);
create table if not exists public.finance_monthly_reviews(
 id uuid primary key default gen_random_uuid(),month date not null unique check(month=date_trunc('month',month)::date),
 opening_balance numeric not null,income numeric not null,expense numeric not null,closing_balance numeric not null,
 actual_balance numeric not null,difference numeric not null,approved_count bigint not null,rejected_count bigint not null,
 note text not null check(length(trim(note)) between 10 and 3000),reviewed_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.finance_receipts enable row level security;alter table public.finance_monthly_reviews enable row level security;
revoke all on public.finance_receipts,public.finance_monthly_reviews from public,anon,authenticated;
grant select on public.finance_receipts,public.finance_monthly_reviews to authenticated;
drop policy if exists finance_receipts_admin on public.finance_receipts;
create policy finance_receipts_admin on public.finance_receipts for select to authenticated using(public.is_admin());
drop policy if exists finance_month_read on public.finance_monthly_reviews;
create policy finance_month_read on public.finance_monthly_reviews for select to authenticated using(public.is_admin() or public.has_officer_role('treasurer'));
drop trigger if exists finance_receipt_immutable on public.finance_receipts;
create trigger finance_receipt_immutable before update or delete on public.finance_receipts for each row execute function public.reject_club_ledger_change();
drop trigger if exists finance_month_immutable on public.finance_monthly_reviews;
create trigger finance_month_immutable before update or delete on public.finance_monthly_reviews for each row execute function public.reject_club_ledger_change();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('club-finance-receipts','club-finance-receipts',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists finance_file_read on storage.objects;
create policy finance_file_read on storage.objects for select to authenticated using(bucket_id='club-finance-receipts' and public.is_admin());
drop policy if exists finance_file_upload on storage.objects;
create policy finance_file_upload on storage.objects for insert to authenticated with check(bucket_id='club-finance-receipts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists finance_file_cleanup on storage.objects;
create policy finance_file_cleanup on storage.objects for delete to authenticated using(bucket_id='club-finance-receipts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.finance_receipts r where r.storage_path=name));

create or replace function public.guard_finance_period() returns trigger language plpgsql security definer set search_path='' as $$
declare v_closed date;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(7421,1);
 select (max(month)+interval '1 month')::date into v_closed from public.finance_monthly_reviews;
 if new.occurred_on>=current_date+1 then raise exception 'Transactions cannot be dated in the future';end if;
 if v_closed is not null and new.occurred_on<v_closed then raise exception 'This finance period is closed; record a correction in an open month';end if;
 return new;
end $$;
revoke all on function public.guard_finance_period() from public,anon,authenticated;
drop trigger if exists finance_period_guard on public.finance_entries;
create trigger finance_period_guard before insert on public.finance_entries for each row execute function public.guard_finance_period();

create or replace function public.register_finance_receipt(p_entry uuid,p_path text,p_name text,p_size bigint,p_mime text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_date date;v_id uuid;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(7421,1);
 select occurred_on into v_date from public.finance_entries where id=p_entry for update;
 if not found then raise exception 'Transaction not found';end if;
 if exists(select 1 from public.finance_monthly_reviews where v_date<(month+interval '1 month')::date) then raise exception 'This finance period is closed';end if;
 if p_path is null or p_path not like auth.uid()::text||'/'||p_entry::text||'/%' or p_name is null or length(p_name) not between 1 and 160 or p_size is null or p_size not between 1 and 10485760 or p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') then raise exception 'Upload a valid receipt of up to 10 MB';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='club-finance-receipts' and o.name=p_path and o.metadata->>'size'=p_size::text and o.metadata->>'mimetype'=p_mime) then raise exception 'Receipt upload could not be verified';end if;
 insert into public.finance_receipts(entry_id,storage_path,file_name,file_size,mime_type,uploaded_by) values(p_entry,p_path,p_name,p_size,p_mime,auth.uid()) returning id into v_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'finance_receipt_attached','finance',p_entry);
 return v_id;
end $$;
revoke all on function public.register_finance_receipt(uuid,text,text,bigint,text) from public,anon;
grant execute on function public.register_finance_receipt(uuid,text,text,bigint,text) to authenticated;

create or replace function public.review_finance_entry(p_entry uuid,p_decision text,p_note text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare v_entry public.finance_entries%rowtype;v_id uuid;v_note text:=trim(coalesce(p_note,''));begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_decision is null or p_decision not in ('approved','rejected') or length(v_note)>2000 or p_decision='rejected' and length(v_note)=0 then raise exception 'Choose a decision and explain rejections';end if;
 perform pg_advisory_xact_lock(7421,1);
 select * into v_entry from public.finance_entries where id=p_entry for update;
 if not found then raise exception 'Transaction not found';end if;
 if exists(select 1 from public.finance_monthly_reviews where v_entry.occurred_on<(month+interval '1 month')::date) then raise exception 'This finance period is closed';end if;
 if exists(select 1 from public.finance_reviews where entry_id=p_entry) then raise exception 'This transaction was already reviewed';end if;
 if p_decision='approved' and not exists(select 1 from public.finance_receipts where entry_id=p_entry) then raise exception 'Attach a receipt before approving this transaction';end if;
 insert into public.finance_reviews(entry_id,decision,reviewer_id,note) values(p_entry,p_decision,auth.uid(),v_note) returning id into v_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'finance_'||p_decision,'finance',p_entry);
 return v_id;
end $$;
revoke all on function public.review_finance_entry(uuid,text,text) from public,anon;
grant execute on function public.review_finance_entry(uuid,text,text) to authenticated;

create or replace function public.finance_month_report(p_month date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date:=date_trunc('month',p_month)::date;v_end date;v_open numeric;v_income numeric;v_expense numeric;v_result jsonb;begin
 if not(public.is_admin() or public.has_officer_role('treasurer')) then raise exception 'Finance report access required';end if;
 if p_month is null then raise exception 'Choose a month';end if;v_end:=(v_start+interval '1 month')::date;
 select coalesce(sum(case when e.entry_type='income' then e.amount else -e.amount end),0) into v_open from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved' where e.occurred_on<v_start;
 select coalesce(sum(e.amount) filter(where e.entry_type='income'),0),coalesce(sum(e.amount) filter(where e.entry_type='expense'),0) into v_income,v_expense from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved' where e.occurred_on>=v_start and e.occurred_on<v_end;
 v_result:=jsonb_build_object('month',v_start,'opening_balance',v_open,'income',v_income,'expense',v_expense,'closing_balance',v_open+v_income-v_expense,'approved_count',(select count(*) from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved' where e.occurred_on>=v_start and e.occurred_on<v_end),'review',(select to_jsonb(m) from public.finance_monthly_reviews m where m.month=v_start),'categories',coalesce((select jsonb_agg(x) from(select e.entry_type,e.category,sum(e.amount) amount from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved' where e.occurred_on>=v_start and e.occurred_on<v_end group by e.entry_type,e.category order by e.entry_type,e.category)x),'[]'::jsonb));
 if public.is_admin() then v_result:=v_result||jsonb_build_object('pending_count',(select count(*) from public.finance_entries e where e.occurred_on<v_end and not exists(select 1 from public.finance_reviews r where r.entry_id=e.id)),'missing_receipts',(select count(*) from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved' where e.occurred_on<v_end and not exists(select 1 from public.finance_receipts f where f.entry_id=e.id)),'last_closed_month',(select max(month) from public.finance_monthly_reviews));end if;
 return v_result;
end $$;
revoke all on function public.finance_month_report(date) from public,anon;
grant execute on function public.finance_month_report(date) to authenticated;
create or replace function public.finance_report_entries(p_month date,p_offset integer default 0,p_limit integer default 50) returns table(id uuid,voucher_number bigint,occurred_on date,entry_type text,category text,amount numeric,description text,reference text) language plpgsql stable security definer set search_path='' as $$
begin
 if not(public.is_admin() or public.has_officer_role('treasurer')) then raise exception 'Finance report access required';end if;
 if p_month is null or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid report page';end if;
 return query select e.id,e.voucher_number,e.occurred_on,e.entry_type,e.category,e.amount,e.description,e.reference from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='approved' where e.occurred_on>=date_trunc('month',p_month)::date and e.occurred_on<(date_trunc('month',p_month)+interval '1 month')::date order by e.occurred_on,e.voucher_number limit p_limit offset p_offset;
end $$;
revoke all on function public.finance_report_entries(date,integer,integer) from public,anon;
grant execute on function public.finance_report_entries(date,integer,integer) to authenticated;

create or replace function public.close_finance_month(p_month date,p_actual numeric,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_start date:=date_trunc('month',p_month)::date;v_report jsonb;v_last date;v_id uuid;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_month is null or v_start>=date_trunc('month',current_date)::date then raise exception 'Review a completed calendar month';end if;
 if p_actual is null or p_actual::text in ('NaN','Infinity','-Infinity') or abs(p_actual)>9999999999.99 or p_actual<>round(p_actual,2) or p_note is null or length(trim(p_note)) not between 10 and 3000 then raise exception 'Enter an actual closing balance and review notes';end if;
 perform pg_advisory_xact_lock(7421,1);
 select max(month) into v_last from public.finance_monthly_reviews;
 if v_last is not null and v_start<>(v_last+interval '1 month')::date then raise exception 'Review the next month after the latest closed month';end if;
 v_report:=public.finance_month_report(v_start);
 if (v_report->>'pending_count')::bigint>0 then raise exception 'Review all pending transactions through this month first';end if;
 if (v_report->>'missing_receipts')::bigint>0 then raise exception 'Attach missing receipts to all approved transactions through this month';end if;
 insert into public.finance_monthly_reviews(month,opening_balance,income,expense,closing_balance,actual_balance,difference,approved_count,rejected_count,note,reviewed_by) values(v_start,(v_report->>'opening_balance')::numeric,(v_report->>'income')::numeric,(v_report->>'expense')::numeric,(v_report->>'closing_balance')::numeric,p_actual,p_actual-(v_report->>'closing_balance')::numeric,(v_report->>'approved_count')::bigint,(select count(*) from public.finance_entries e join public.finance_reviews r on r.entry_id=e.id and r.decision='rejected' where e.occurred_on>=v_start and e.occurred_on<(v_start+interval '1 month')::date),trim(p_note),auth.uid()) returning id into v_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'finance_month_closed','finance_month',v_id);
 return v_id;
end $$;
revoke all on function public.close_finance_month(date,numeric,text) from public,anon;
grant execute on function public.close_finance_month(date,numeric,text) to authenticated;
commit;
