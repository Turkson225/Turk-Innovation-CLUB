-- SPACE: private, temporary drawing in one-to-one club chats.
-- Run this ENTIRE file in Supabase SQL Editor. Safe to run again.
-- Does not save drawings, change direct_messages or change global Realtime settings.
begin;

create or replace function public.club_glow_topic_allowed(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[];
  first_id uuid;
  second_id uuid;
  caller uuid := auth.uid();
  current_minute bigint := floor(extract(epoch from statement_timestamp()) / 60)::bigint;
begin
  if caller is null or p_topic is null or length(p_topic) > 130 then return false; end if;
  if p_topic !~ '^space-glow:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{1,12}$' then return false; end if;
  parts := string_to_array(p_topic, ':');
  first_id := parts[2]::uuid;
  second_id := parts[3]::uuid;
  if first_id >= second_id or caller not in (first_id, second_id)
     or parts[4] <> current_minute::text then return false; end if;
  return (select count(*) = 2 from public.profiles p
    where p.id in (first_id, second_id) and p.membership_status = 'approved'
      and p.role in ('member', 'teacher', 'founder', 'admin'));
end;
$$;

create or replace function public.club_glow_room(p_peer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  at_ms numeric := extract(epoch from statement_timestamp()) * 1000;
  current_minute bigint := floor(at_ms / 60000)::bigint;
  room_topic text;
begin
  if caller is null or p_peer is null or caller = p_peer then
    raise exception 'A different approved club member is required' using errcode = '42501';
  end if;
  room_topic := 'space-glow:' || least(caller, p_peer)::text || ':' || greatest(caller, p_peer)::text || ':' || current_minute::text;
  if not public.club_glow_topic_allowed(room_topic) then
    raise exception 'Approved club participants required' using errcode = '42501';
  end if;
  return jsonb_build_object('topic', room_topic, 'minute', current_minute,
    'lease_ms', greatest(1, floor(60000 - mod(at_ms, 60000))::integer));
end;
$$;

revoke all on function public.club_glow_room(uuid) from public, anon;
revoke all on function public.club_glow_topic_allowed(text) from public, anon;
grant execute on function public.club_glow_room(uuid) to authenticated;
-- Anonymous policy evaluation may call this helper; it returns false before any profile lookup.
grant execute on function public.club_glow_topic_allowed(text) to anon, authenticated;

-- Supabase owns the realtime schema and enables its RLS already.
-- Only manage our policies here; no ALTER TABLE, table grants or schema objects.
drop policy if exists space_glow_receive on realtime.messages;
create policy space_glow_receive on realtime.messages for select to authenticated
using (topic = (select realtime.topic()) and extension = 'broadcast' and public.club_glow_topic_allowed((select realtime.topic())));

drop policy if exists space_glow_send on realtime.messages;
create policy space_glow_send on realtime.messages for insert to authenticated
with check (topic = (select realtime.topic()) and extension = 'broadcast' and public.club_glow_topic_allowed((select realtime.topic())));

-- Existing broad permissive policies must not bypass this namespace's rules.
-- Other applications/topics keep their own existing authorization rules.
drop policy if exists space_glow_guard_receive on realtime.messages;
create policy space_glow_guard_receive on realtime.messages as restrictive for select to public
using (case
  when coalesce((select realtime.topic()), '') like 'space-glow:%' then
    case when (select auth.uid()) is null then false else
      topic = (select realtime.topic()) and extension = 'broadcast' and public.club_glow_topic_allowed((select realtime.topic())) end
  when coalesce(topic, '') like 'space-glow:%' then false
  else true end);

drop policy if exists space_glow_guard_send on realtime.messages;
create policy space_glow_guard_send on realtime.messages as restrictive for insert to public
with check (case
  when coalesce((select realtime.topic()), '') like 'space-glow:%' then
    case when (select auth.uid()) is null then false else
      topic = (select realtime.topic()) and extension = 'broadcast' and public.club_glow_topic_allowed((select realtime.topic())) end
  when coalesce(topic, '') like 'space-glow:%' then false
  else true end);

commit;
