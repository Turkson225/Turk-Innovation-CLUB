-- Run after upgrade_direct_messages.sql, upgrade_media_threads.sql and
-- upgrade_roles_investors.sql. Safe to rerun; existing DM permissions remain intact.
-- Replies, participant reactions, private read receipts and a paginated inbox.

begin;

do $migration$
begin
  if to_regclass('public.direct_messages') is null
     or to_regclass('public.direct_message_reads') is null then
    raise exception 'Run upgrade_direct_messages.sql before upgrade_dm_conversations.sql';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.direct_messages'::regclass
      and attname = 'image_path' and not attisdropped
  ) then
    raise exception 'Run upgrade_media_threads.sql before upgrade_dm_conversations.sql';
  end if;
end;
$migration$;

alter table public.direct_messages add column if not exists reply_to_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.direct_messages'::regclass
      and conname = 'direct_messages_reply_to_id_fkey'
  ) then
    alter table public.direct_messages
      add constraint direct_messages_reply_to_id_fkey
      foreign key (reply_to_id) references public.direct_messages(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.direct_messages'::regclass
      and conname = 'direct_messages_reply_not_self'
  ) then
    alter table public.direct_messages
      add constraint direct_messages_reply_not_self check (reply_to_id <> id);
  end if;
end;
$migration$;

create index if not exists direct_messages_reply_to_idx
  on public.direct_messages(reply_to_id) where reply_to_id is not null;
create index if not exists direct_messages_pair_recent_idx
  on public.direct_messages(sender_id, recipient_id, created_at desc, id desc);

-- Do not query direct_messages from its own INSERT policy: that can recurse
-- through RLS. This trigger validates the relationship with no additional read
-- access for members and returns the same error for missing or private targets.
create or replace function public.club_validate_dm_reply()
returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_caller uuid := auth.uid();
begin
  if new.reply_to_id is null then
    return new;
  end if;
  -- BEFORE triggers run before INSERT RLS checks. Check the caller before any
  -- privileged lookup so a spoofed participant pair cannot probe private IDs.
  if v_caller is null or not public.is_approved()
     or new.sender_id is distinct from v_caller then
    raise exception 'Reply must belong to this conversation' using errcode = '23514';
  end if;
  if (
    new.reply_to_id = new.id
    or not exists (
      select 1 from public.direct_messages parent
      where parent.id = new.reply_to_id
        and (
          (parent.sender_id = new.sender_id and parent.recipient_id = new.recipient_id)
          or (parent.sender_id = new.recipient_id and parent.recipient_id = new.sender_id)
        )
    )
  ) then
    raise exception 'Reply must belong to this conversation' using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.club_validate_dm_reply() from public, anon, authenticated;
drop trigger if exists club_validate_dm_reply on public.direct_messages;
create trigger club_validate_dm_reply
  before insert or update of reply_to_id, sender_id, recipient_id
  on public.direct_messages for each row execute function public.club_validate_dm_reply();

create table if not exists public.direct_message_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(trim(emoji)) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.direct_message_reactions enable row level security;
revoke all on public.direct_message_reactions from public, anon, authenticated;
grant select, delete on public.direct_message_reactions to authenticated;
grant insert(message_id, user_id, emoji) on public.direct_message_reactions to authenticated;

drop policy if exists "Participants read DM reactions" on public.direct_message_reactions;
create policy "Participants read DM reactions" on public.direct_message_reactions
  for select to authenticated
  using (public.is_approved() and exists (
    select 1 from public.direct_messages message
    where message.id = direct_message_reactions.message_id
      and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
  ));

drop policy if exists "Participants add own DM reactions" on public.direct_message_reactions;
create policy "Participants add own DM reactions" on public.direct_message_reactions
  for insert to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()) and exists (
    select 1 from public.direct_messages message
    where message.id = direct_message_reactions.message_id
      and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
  ));

drop policy if exists "Participants remove own DM reactions" on public.direct_message_reactions;
create policy "Participants remove own DM reactions" on public.direct_message_reactions
  for delete to authenticated
  using (public.is_approved() and user_id = (select auth.uid()) and exists (
    select 1 from public.direct_messages message
    where message.id = direct_message_reactions.message_id
      and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
  ));

-- Read positions stay owner-only under their existing policies. This narrowly
-- scoped RPC exposes only this peer's receipt for messages the caller sent.
-- No outgoing message, no approval, no receipt, or an invalid peer => NULL.
create or replace function public.club_dm_peer_read_at(p_peer_id uuid)
returns timestamptz
language sql stable security definer set search_path = '' as $function$
  select least(receipt.last_read_at, now())
  from public.direct_message_reads receipt
  where receipt.user_id = p_peer_id
    and receipt.peer_id = (select auth.uid())
    and public.is_approved()
    and exists (
      select 1 from public.direct_messages sent
      where sent.sender_id = (select auth.uid()) and sent.recipient_id = p_peer_id
    );
$function$;

revoke all on function public.club_dm_peer_read_at(uuid) from public, anon;
grant execute on function public.club_dm_peer_read_at(uuid) to authenticated;

-- SECURITY INVOKER retains the existing participant RLS on direct_messages.
-- Each peer appears once, with their latest visible message. UUID breaks ties
-- between timestamps; pagination uses the same deterministic newest-first order.
create or replace function public.club_dm_inbox(p_limit integer default 100, p_offset integer default 0)
returns table (
  peer_id uuid,
  message_id uuid,
  sender_id uuid,
  body text,
  image_path text,
  created_at timestamptz
)
language sql stable security invoker set search_path = '' as $function$
  with caller as (
    select auth.uid() as id where public.is_approved()
  ), conversation_messages as (
    select message.recipient_id as peer_id, message.id as message_id,
      message.sender_id, message.body, message.image_path, message.created_at
    from public.direct_messages message join caller on message.sender_id = caller.id
    union all
    select message.sender_id as peer_id, message.id as message_id,
      message.sender_id, message.body, message.image_path, message.created_at
    from public.direct_messages message join caller on message.recipient_id = caller.id
  ), latest as (
    select distinct on (conversation_messages.peer_id) conversation_messages.*
    from conversation_messages
    order by conversation_messages.peer_id,
      conversation_messages.created_at desc, conversation_messages.message_id desc
  )
  select latest.peer_id, latest.message_id, latest.sender_id,
    latest.body, latest.image_path, latest.created_at
  from latest
  order by latest.created_at desc, latest.message_id desc
  limit least(100, greatest(1, coalesce(p_limit, 100)))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

revoke all on function public.club_dm_inbox(integer, integer) from public, anon;
grant execute on function public.club_dm_inbox(integer, integer) to authenticated;

-- Reactions are deliberately not added to Realtime here. A client can refresh
-- the current conversation; existing notification/message subscriptions work.
notify pgrst, 'reload schema';
commit;
