-- Run once after upgrade_activity_feed.sql in Supabase SQL Editor.
-- Private one-to-one messages, unread positions and optional member profile details.

alter table public.profiles add column if not exists headline text not null default ''
  check (char_length(headline) <= 120);
alter table public.profiles add column if not exists bio text not null default ''
  check (char_length(bio) <= 1200);
alter table public.profiles add column if not exists availability text not null default 'available'
  check (availability in ('available','busy','away'));
grant update(headline,bio,availability) on public.profiles to authenticated;

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index direct_messages_sender_recent on public.direct_messages(sender_id,created_at desc);
create index direct_messages_recipient_recent on public.direct_messages(recipient_id,created_at desc);
alter table public.direct_messages enable row level security;
revoke all on public.direct_messages from anon,authenticated;
grant select,insert on public.direct_messages to authenticated;
create policy "Participants read direct messages" on public.direct_messages for select to authenticated
  using (public.is_approved() and (sender_id=(select auth.uid()) or recipient_id=(select auth.uid())));
create policy "Members send direct messages to approved members" on public.direct_messages for insert to authenticated
  with check (public.is_approved() and sender_id=(select auth.uid())
    and exists(select 1 from public.profiles p where p.id=recipient_id and p.membership_status='approved'));

create table public.direct_message_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  peer_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(user_id,peer_id),
  check (user_id <> peer_id)
);
alter table public.direct_message_reads enable row level security;
revoke all on public.direct_message_reads from anon,authenticated;
grant select,insert on public.direct_message_reads to authenticated;
grant update(last_read_at) on public.direct_message_reads to authenticated;
create policy "Members read own DM positions" on public.direct_message_reads for select to authenticated
  using (public.is_approved() and user_id=(select auth.uid()));
create policy "Members mark their DM positions" on public.direct_message_reads for insert to authenticated
  with check (public.is_approved() and user_id=(select auth.uid()));
create policy "Members update their DM positions" on public.direct_message_reads for update to authenticated
  using (public.is_approved() and user_id=(select auth.uid()))
  with check (public.is_approved() and user_id=(select auth.uid()));

create or replace function public.notify_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    values(new.recipient_id,'direct_message','New direct message from ' ||
      coalesce((select full_name from public.profiles where id=new.sender_id),'a member'),'direct_message',new.sender_id);
  return new;
end $$;
create trigger on_direct_message after insert on public.direct_messages
  for each row execute function public.notify_direct_message();
