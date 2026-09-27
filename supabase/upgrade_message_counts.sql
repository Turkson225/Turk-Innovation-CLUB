-- Run after upgrade_membership_collaboration.sql, upgrade_direct_messages.sql,
-- and upgrade_roles_investors.sql. Safe to rerun.
-- Unread counts are calculated on the server for the signed-in participant;
-- the client never needs to download all private messages to count them.

create or replace function public.club_unread_counts()
returns jsonb
language sql stable security definer set search_path = '' as $$
  with caller as (
    select auth.uid() as id
  ), permitted as (
    select c.id from caller c
      join public.profiles p on p.id=c.id
     where p.membership_status='approved'
       and p.role in ('member','teacher','founder','admin')
  ), channels as (
    select m.channel_id,count(*)::bigint as unread_count
      from public.channel_messages m
      cross join permitted p
      left join public.channel_reads r
        on r.channel_id=m.channel_id and r.user_id=p.id
     where m.author_id<>p.id
       and m.deleted_at is null
       and (r.last_read_at is null or m.created_at>r.last_read_at)
     group by m.channel_id
  ), messages as (
    select m.sender_id,count(*)::bigint as unread_count
      from public.direct_messages m
      join permitted p on p.id=m.recipient_id
      left join public.direct_message_reads r
        on r.user_id=p.id and r.peer_id=m.sender_id
     where r.last_read_at is null or m.created_at>r.last_read_at
     group by m.sender_id
  ), direct_peers as (
    select distinct case when m.sender_id=p.id then m.recipient_id else m.sender_id end as peer_id
      from public.direct_messages m
      join permitted p on m.sender_id=p.id or m.recipient_id=p.id
  )
  select case when exists(select 1 from permitted) then jsonb_build_object(
    'channels',coalesce((select jsonb_object_agg(channel_id::text,unread_count)
                           from channels),'{}'::jsonb),
    'direct_messages',coalesce((select jsonb_object_agg(sender_id::text,unread_count)
                                  from messages),'{}'::jsonb),
    'direct_peers',coalesce((select jsonb_agg(peer_id::text) from direct_peers),'[]'::jsonb),
    'direct_total',coalesce((select sum(unread_count) from messages),0)
  ) else null end;
$$;

revoke all on function public.club_unread_counts() from public,anon;
grant execute on function public.club_unread_counts() to authenticated;
