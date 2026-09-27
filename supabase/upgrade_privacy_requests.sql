-- Run after upgrade_roles_investors.sql and upgrade_profile_images.sql.
-- Members control whether their profile appears to other club members.
-- Admins retain access for application review and club moderation.

alter table public.profiles
  add column if not exists profile_visibility text not null default 'club';
alter table public.profiles drop constraint if exists profiles_profile_visibility_check;
alter table public.profiles add constraint profiles_profile_visibility_check
  check (profile_visibility in ('club','private'));
grant update(profile_visibility) on public.profiles to authenticated;

drop policy if exists "Member directory" on public.profiles;
create policy "Member directory" on public.profiles for select to authenticated
  using (
    id=(select auth.uid()) or public.is_admin() or
    (public.is_approved() and membership_status='approved'
      and role<>'investor' and profile_visibility='club')
  );

-- Preserve the avatar path ownership check from upgrade_profile_images.sql.
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated
  using (id=(select auth.uid()))
  with check (id=(select auth.uid()) and
    (avatar_path is null or split_part(avatar_path,'/',1)=(select auth.uid()::text)));

-- Existing INSERT policies checked recipient/collaborator profiles through
-- their caller's SELECT policy. Private profiles must remain usable for direct
-- messages and project invitations even though their directory row is hidden.
create or replace function public.is_eligible_club_member(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_approved() and exists(select 1 from public.profiles p
    where p.id=p_user and p.membership_status='approved'
      and p.role in ('member','teacher','founder','admin'));
$$;
revoke all on function public.is_eligible_club_member(uuid) from public,anon;
grant execute on function public.is_eligible_club_member(uuid) to authenticated;

drop policy if exists "Members send direct messages to approved members" on public.direct_messages;
create policy "Members send direct messages to approved members" on public.direct_messages
  for insert to authenticated
  with check (public.is_approved() and sender_id=(select auth.uid())
    and public.is_eligible_club_member(recipient_id)
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));

drop policy if exists "Owners add collaborators" on public.project_members;
create policy "Owners add collaborators" on public.project_members for insert to authenticated
  with check (public.is_approved() and
    exists(select 1 from public.projects p where p.id=project_id
      and (p.owner_id=(select auth.uid()) or public.is_admin()))
    and public.is_eligible_club_member(user_id));

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references public.profiles(id) on delete set null,
  requester_auth_id uuid default auth.uid(),
  request_type text not null check (request_type in ('account_removal','content_removal')),
  details text not null default '' check (char_length(details) <= 2000 and
    (request_type<>'content_removal' or char_length(trim(details)) >= 10)),
  status text not null default 'open'
    check (status in ('open','in_review','completed','declined')),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_note text not null default '' check (char_length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
-- The Auth ID survives profile deletion just long enough to verify that the
-- Auth account itself has been removed, then is cleared on completion.
alter table public.privacy_requests
  add column if not exists requester_auth_id uuid default auth.uid();
update public.privacy_requests set requester_auth_id=requester_id
  where requester_auth_id is null and requester_id is not null
    and status in ('open','in_review');
create index if not exists privacy_requests_recent_idx on public.privacy_requests(created_at desc);
create unique index if not exists privacy_requests_one_open_per_type_idx
  on public.privacy_requests(requester_id,request_type)
  where status in ('open','in_review');
alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from public,anon,authenticated;
grant select on public.privacy_requests to authenticated;
grant insert(requester_id,request_type,details) on public.privacy_requests to authenticated;

drop policy if exists "Members see own privacy requests" on public.privacy_requests;
create policy "Members see own privacy requests" on public.privacy_requests for select to authenticated
  using (requester_id=(select auth.uid()) or public.is_admin());
drop policy if exists "Members submit privacy requests" on public.privacy_requests;
create policy "Members submit privacy requests" on public.privacy_requests for insert to authenticated
  with check (requester_id=(select auth.uid()) and requester_auth_id=(select auth.uid())
    and status='open'
    and reviewer_id is null and reviewed_at is null and review_note='');

create or replace function public.notify_privacy_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id,kind,title,target_type,target_id)
    select p.id,'privacy','New privacy request','privacy_request',new.id
    from public.profiles p where p.role='admin' and p.membership_status='approved';
  return new;
end $$;
revoke all on function public.notify_privacy_request() from public,anon,authenticated;
drop trigger if exists on_privacy_request_created on public.privacy_requests;
create trigger on_privacy_request_created after insert on public.privacy_requests
  for each row execute function public.notify_privacy_request();

-- Status changes are administered through this RPC. The website cannot delete
-- Auth users, uploaded files or related records with its publishable key.
-- Mark an account-removal request completed only after handling those separately.
create or replace function public.review_privacy_request(
  p_request uuid,p_status text,p_note text default ''
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.privacy_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('in_review','completed','declined') then
    raise exception 'Invalid privacy request status';
  end if;
  select * into v_row from public.privacy_requests where id=p_request for update;
  if not found then raise exception 'Privacy request not found'; end if;
  if v_row.status not in ('open','in_review') or
     (v_row.status='open' and p_status='completed') or
     (v_row.status='in_review' and p_status='in_review') then
    raise exception 'Invalid privacy request status transition';
  end if;
  if p_status in ('completed','declined') and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'Explain the outcome to the requester';
  end if;
  if p_status='completed' and v_row.request_type='account_removal'
      and (v_row.requester_id is not null or v_row.requester_auth_id is null
        or exists(select 1 from auth.users u where u.id=v_row.requester_auth_id)) then
    raise exception 'Remove the Auth account and its related data before completing this request';
  end if;
  if char_length(coalesce(p_note,'')) > 2000 then
    raise exception 'The review note is too long';
  end if;

  update public.privacy_requests
    set status=p_status,reviewer_id=auth.uid(),review_note=coalesce(p_note,''),reviewed_at=now(),
      requester_auth_id=case when p_status='completed' and request_type='account_removal'
        then null else requester_auth_id end,
      details=case when p_status='completed' and request_type='account_removal' then '' else details end
    where id=p_request;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'privacy_request_'||p_status,'privacy_request',p_request);
  if v_row.requester_id is not null then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(v_row.requester_id,'privacy','Privacy request '||replace(p_status,'_',' '),
        'privacy_request',p_request);
  end if;
end $$;
revoke all on function public.review_privacy_request(uuid,text,text) from public,anon;
grant execute on function public.review_privacy_request(uuid,text,text) to authenticated;
