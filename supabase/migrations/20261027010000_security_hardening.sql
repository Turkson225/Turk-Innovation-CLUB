-- SPACE security hardening. Apply AFTER the tracked legacy baseline.
-- Deploy the matching authenticator UI first. No accounts, messages or files are deleted.
begin;

create schema if not exists space_private;
revoke all on schema space_private from public, anon, authenticated;

-- Read directly as the function owner to avoid policy recursion. Missing AAL fails closed.
create or replace function public.space_admin_mfa_satisfied()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.role='admin')
    or coalesce((select auth.jwt())->>'aal','')='aal2';
$$;
revoke all on function public.space_admin_mfa_satisfied() from public;
grant execute on function public.space_admin_mfa_satisfied() to anon, authenticated;

create or replace function public.space_require_admin_mfa()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.space_admin_mfa_satisfied() then
    raise exception using errcode='42501', message='Administrator verification required',
      detail='SPACE_ADMIN_MFA_REQUIRED', hint='Verify your authenticator in SPACE and retry.';
  end if;
end;
$$;
revoke all on function public.space_require_admin_mfa() from public;
grant execute on function public.space_require_admin_mfa() to authenticated;

create or replace function public.space_require_recent_admin_mfa()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.space_require_admin_mfa();
  if exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin')
    and not exists(select 1 from jsonb_array_elements(
      case when jsonb_typeof((select auth.jwt())->'amr')='array' then (select auth.jwt())->'amr' else '[]'::jsonb end) a
      where a->>'method'='totp' and case when a->>'timestamp' ~ '^[0-9]{1,12}$'
        then (a->>'timestamp')::numeric between extract(epoch from now())-900 and extract(epoch from now())+30 else false end)
  then
    raise exception using errcode='42501',message='Verify your authenticator again before this sensitive change',
      detail='SPACE_ADMIN_MFA_RECENT_REQUIRED';
  end if;
end;
$$;
revoke all on function public.space_require_recent_admin_mfa() from public;
grant execute on function public.space_require_recent_admin_mfa() to authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and role='admin' and membership_status='approved')
    and coalesce((select auth.jwt())->>'aal','')='aal2';
$$;
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and membership_status='approved') and public.space_admin_mfa_satisfied();
$$;
create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and membership_status='approved' and role in ('founder','admin'))
    and public.space_admin_mfa_satisfied();
$$;
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and membership_status='approved' and (role in ('teacher','admin')
      or role='founder' and founder_teaching_enabled)) and public.space_admin_mfa_satisfied();
$$;

create or replace function public.space_guard_admin_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.space_require_admin_mfa();
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.space_guard_admin_write() from public,anon,authenticated;

-- Restrictive policies compose with existing permissive policies. The own profile
-- SELECT exception bootstraps the MFA screen; it grants no new SELECT privilege.
do $$ declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  loop
    execute format('alter table public.%I enable row level security',t.relname);
    execute format('drop policy if exists space_admin_mfa_select on public.%I',t.relname);
    execute format('create policy space_admin_mfa_select on public.%I as restrictive for select to authenticated using (public.space_admin_mfa_satisfied()%s)',
      t.relname,case when t.relname='profiles' then ' or id=(select auth.uid())' else '' end);
    execute format('drop policy if exists space_admin_mfa_insert on public.%I',t.relname);
    execute format('create policy space_admin_mfa_insert on public.%I as restrictive for insert to authenticated with check (public.space_admin_mfa_satisfied())',t.relname);
    execute format('drop policy if exists space_admin_mfa_update on public.%I',t.relname);
    execute format('create policy space_admin_mfa_update on public.%I as restrictive for update to authenticated using (public.space_admin_mfa_satisfied()) with check (public.space_admin_mfa_satisfied())',t.relname);
    execute format('drop policy if exists space_admin_mfa_delete on public.%I',t.relname);
    execute format('create policy space_admin_mfa_delete on public.%I as restrictive for delete to authenticated using (public.space_admin_mfa_satisfied())',t.relname);
    -- A definer RPC bypasses RLS, but cannot bypass this trigger.
    execute format('drop trigger if exists space_admin_mfa_write on public.%I',t.relname);
    execute format('create trigger space_admin_mfa_write before insert or update or delete on public.%I for each row execute function public.space_guard_admin_write()',t.relname);
  end loop;
end $$;

do $$ declare t text;
begin
  foreach t in array array['storage.objects','realtime.messages'] loop
    if to_regclass(t) is not null then
      execute format('drop policy if exists space_admin_mfa_access on %s',t);
      execute format('create policy space_admin_mfa_access on %s as restrictive for all to authenticated using (public.space_admin_mfa_satisfied()) with check (public.space_admin_mfa_satisfied())',t);
    end if;
  end loop;
end $$;

-- Guard executable PL/pgSQL definer entry points, including legacy functions that
-- check profiles.role inline. Keep ownership, grants, defaults and return types.
-- The explicit marker makes applying this migration again idempotent.
do $$ declare f record; body text; definition text; guard text;
begin
  for f in select p.oid,p.prosrc,p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prosecdef and l.lanname='plpgsql'
      and p.prorettype<>'trigger'::regtype and p.prokind='f'
      and p.proname not in ('space_require_admin_mfa','space_require_recent_admin_mfa')
      and has_function_privilege('authenticated',p.oid,'execute')
      and position('-- SPACE_MFA_ENTRY_GUARD' in p.prosrc)=0
  loop
    guard:=case when f.proname in ('assign_account_role','set_club_officer_roles','space_set_officer_roles','review_membership','review_finance_entry','close_finance_month')
      then 'space_require_recent_admin_mfa' else 'space_require_admin_mfa' end;
    body:=regexp_replace(f.prosrc,'\mbegin\M', E'begin\n  -- SPACE_MFA_ENTRY_GUARD\n  perform public.'||guard||'();', 'i');
    if body=f.prosrc then raise exception 'Could not guard function %',f.oid::regprocedure; end if;
    definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);
    execute definition;
  end loop;
end $$;

-- One counter row per actor/scope/target/window length: counters reset in place.
-- Atomic UPSERT locks each key, so concurrent requests cannot race a SELECT count.
create table if not exists space_private.action_quotas(
  actor_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  target text not null default '',
  seconds integer not null check(seconds in (60,3600,86400)),
  started_at timestamptz not null,
  used integer not null check(used>0),
  primary key(actor_id,scope,target,seconds)
);
revoke all on space_private.action_quotas from public,anon,authenticated;

create or replace function space_private.consume_quota(p_actor uuid,p_scope text,p_target text,p_seconds integer,p_limit integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz:=clock_timestamp(); v_used integer;
begin
  insert into space_private.action_quotas as q(actor_id,scope,target,seconds,started_at,used)
    values(p_actor,p_scope,p_target,p_seconds,v_now,1)
    on conflict(actor_id,scope,target,seconds) do update set
      used=case when q.started_at<=v_now-make_interval(secs=>p_seconds) then 1 else q.used+1 end,
      started_at=case when q.started_at<=v_now-make_interval(secs=>p_seconds) then v_now else q.started_at end
    returning used into v_used;
  if v_used>p_limit then
    raise exception using errcode='P0001',message='You are sending updates too quickly. Please try again shortly.',
      detail='SPACE_RATE_LIMIT',hint='Wait for the current limit window to reset.';
  end if;
end;
$$;
revoke all on function space_private.consume_quota(uuid,text,text,integer,integer) from public,anon,authenticated;

create or replace function public.space_limit_member_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=(select auth.uid()); v_owner uuid; v_target text:=''; v_scope text:='conversation';
begin
  -- Trusted service/database jobs have no member JWT. RLS still applies to clients.
  if v_actor is null then return new; end if;
  if tg_table_name='direct_messages' then v_owner:=new.sender_id; v_target:=new.recipient_id::text;
  else v_owner:=new.author_id; end if;
  if v_owner is distinct from v_actor then raise exception 'Use your own account to post' using errcode='42501'; end if;
  if tg_table_name in ('activity_posts','topics') then v_scope:='publication'; end if;
  perform space_private.consume_quota(v_actor,v_scope,'',60,case when v_scope='publication' then 10 else 40 end);
  perform space_private.consume_quota(v_actor,v_scope,'',3600,case when v_scope='publication' then 100 else 400 end);
  perform space_private.consume_quota(v_actor,v_scope,'',86400,case when v_scope='publication' then 300 else 2000 end);
  if v_target<>'' then perform space_private.consume_quota(v_actor,'dm-recipient',v_target,60,20); end if;
  return new;
end;
$$;
revoke all on function public.space_limit_member_updates() from public,anon,authenticated;
do $$ declare t text;
begin
  foreach t in array array['direct_messages','channel_messages','activity_comments','activity_posts','topics','replies'] loop
    execute format('drop trigger if exists space_member_update_limit on public.%I',t);
    execute format('create trigger space_member_update_limit before insert on public.%I for each row execute function public.space_limit_member_updates()',t);
  end loop;
end $$;

create or replace function public.space_limit_notification_fanout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null then return new; end if;
  perform space_private.consume_quota(v_actor,'notification','',60,case when public.is_admin() then 5000 else 1000 end);
  perform space_private.consume_quota(v_actor,'notification-recipient',new.user_id::text,60,120);
  return new;
end;
$$;
revoke all on function public.space_limit_notification_fanout() from public,anon,authenticated;
drop trigger if exists space_notification_fanout_limit on public.notifications;
create trigger space_notification_fanout_limit before insert on public.notifications
  for each row execute function public.space_limit_notification_fanout();

-- Future public objects must not silently become available to API roles.
alter default privileges in schema public revoke all on tables from anon,authenticated;
alter default privileges in schema public revoke execute on functions from public;
commit;
