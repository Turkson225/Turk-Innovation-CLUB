-- Run after upgrade_club_shop.sql, upgrade_shop_order_tracking.sql,
-- upgrade_direct_messages.sql and upgrade_message_counts.sql. Safe to rerun.
begin;
do $$ begin
 if to_regclass('public.space_shop_orders') is null
   or to_regclass('public.direct_message_reads') is null
   or to_regprocedure('public.club_unread_counts()') is null then
  raise exception 'Run the shop, direct messages and message counts migrations first';
 end if;
end $$;

create or replace function public.space_shop_order_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 return (select jsonb_build_object(
  'all',count(*),'pending',count(*) filter(where status='pending'),
  'confirmed',count(*) filter(where status='confirmed'),'ready',count(*) filter(where status='ready'),
  'collected',count(*) filter(where status='collected'),'cancelled',count(*) filter(where status='cancelled'),
  'active_cents',coalesce(sum(total_cents) filter(where status in ('pending','confirmed','ready')),0),
  'paid_cents',coalesce(sum(total_cents) filter(where status='collected' and payment_status='paid'),0)
 ) from public.space_shop_orders);
end $$;
revoke all on function public.space_shop_order_summary() from public,anon;
grant execute on function public.space_shop_order_summary() to authenticated;

-- The server derives the receipt boundary from an actual incoming message.
-- A read receipt cannot advance into the future or move another user's cursor.
-- Notifications are the exact IDs captured before loading that conversation;
-- their timestamps may be later than the message that generated them.
create or replace function public.club_mark_dm_read(p_peer uuid,p_message uuid,p_notices uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_boundary timestamptz;v_stamp timestamptz;v_ids jsonb;
begin
 if v_user is null or not public.is_approved() or p_peer is null or p_peer=v_user then
  raise exception 'Approved member access required';
 end if;
 if coalesce(cardinality(p_notices),0)>1000 then raise exception 'Too many message alerts';end if;
 select least(created_at,now()) into v_boundary from public.direct_messages
  where id=p_message and sender_id=p_peer and recipient_id=v_user;
 if not found then raise exception 'Incoming message unavailable';end if;
 insert into public.direct_message_reads(user_id,peer_id,last_read_at) values(v_user,p_peer,v_boundary)
 on conflict(user_id,peer_id) do update
  set last_read_at=greatest(public.direct_message_reads.last_read_at,excluded.last_read_at)
 returning last_read_at into v_stamp;
 update public.notifications set read_at=now()
   where user_id=v_user and kind='direct_message' and target_id=p_peer
    and (id=any(coalesce(p_notices,'{}'::uuid[])) or created_at<=v_boundary) and read_at is null;
 select coalesce(jsonb_agg(id),'[]'::jsonb) into v_ids from public.notifications
  where user_id=v_user and kind='direct_message' and target_id=p_peer
   and id=any(coalesce(p_notices,'{}'::uuid[])) and read_at is not null;
 return jsonb_build_object('last_read_at',v_stamp,'read_notice_ids',v_ids,'counts',public.club_unread_counts());
end $$;
revoke all on function public.club_mark_dm_read(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.club_mark_dm_read(uuid,uuid,uuid[]) to authenticated;

-- Only the sender can retrieve the other participant's receipt for this pair.
create or replace function public.club_dm_peer_read_at(p_peer_id uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
 select least(receipt.last_read_at,now()) from public.direct_message_reads receipt
 where receipt.user_id=p_peer_id and receipt.peer_id=(select auth.uid()) and public.is_approved()
  and exists(select 1 from public.direct_messages sent
    where sent.sender_id=(select auth.uid()) and sent.recipient_id=p_peer_id)
$$;
revoke all on function public.club_dm_peer_read_at(uuid) from public,anon;
grant execute on function public.club_dm_peer_read_at(uuid) to authenticated;

-- Clear legacy alerts already covered by a recorded read position.
update public.notifications n set read_at=now()
 from public.direct_message_reads r
 where n.user_id=r.user_id and n.target_id=r.peer_id and n.kind='direct_message'
  and n.read_at is null and n.created_at<=least(r.last_read_at,now());

notify pgrst,'reload schema';
commit;
