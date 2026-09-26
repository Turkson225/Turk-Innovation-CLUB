-- Run once after upgrade_profile_images.sql in Supabase SQL Editor.
-- Applicant preference is never an authorization role. Only an administrator approves it.

alter table public.profiles add column if not exists application_type text not null default 'member';
update public.profiles set application_type=role where role='founder' and application_type='member';
alter table public.profiles drop constraint if exists profiles_application_type_check;
alter table public.profiles add constraint profiles_application_type_check
  check (application_type in ('member','teacher','founder','investor'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member','teacher','founder','investor','admin'));

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and membership_status='approved' and role in ('member','teacher','founder','admin'));
$$;
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and membership_status='approved' and role in ('teacher','admin'));
$$;
create or replace function public.is_investor()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=(select auth.uid())
    and membership_status='approved' and role='investor');
$$;
revoke all on function public.is_teacher(),public.is_investor() from public,anon;
grant execute on function public.is_teacher(),public.is_investor() to authenticated;

drop policy if exists "Member directory" on public.profiles;
create policy "Member directory" on public.profiles for select to authenticated
  using (id=(select auth.uid()) or public.is_admin() or
    (public.is_approved() and membership_status='approved' and role<>'investor'));
drop policy if exists "Members send direct messages to approved members" on public.direct_messages;
create policy "Members send direct messages to approved members" on public.direct_messages for insert to authenticated
  with check (public.is_approved() and sender_id=(select auth.uid())
    and exists(select 1 from public.profiles p where p.id=recipient_id
      and p.membership_status='approved' and p.role<>'investor')
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));

create or replace function public.set_application_type(p_type text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_type not in ('member','teacher','founder','investor') then
    raise exception 'Select a valid applicant type'; end if;
  update public.profiles set application_type=p_type where id=auth.uid()
    and membership_status in ('pending','rejected');
  if not found then raise exception 'Only pending applicants can change their application type'; end if;
end $$;
revoke all on function public.set_application_type(text) from public,anon;
grant execute on function public.set_application_type(text) to authenticated;

create or replace function public.accept_founder_invitation()
returns void language plpgsql security definer set search_path=public as $$
declare v_email text;v_invite uuid;
begin
  if not public.is_approved() then raise exception 'Membership approval required'; end if;
  select lower(email) into v_email from auth.users
    where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email first'; end if;
  update public.founder_invites set accepted_at=now()
    where email=v_email and accepted_at is null returning id into v_invite;
  if v_invite is null then raise exception 'No pending founder invitation'; end if;
  update public.profiles set role='founder',application_type='founder'
    where id=auth.uid() and role in ('member','teacher');
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'founder_accepted','founder_invite',v_invite);
end $$;

create or replace function public.review_membership(p_user uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_type text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('approved','rejected','suspended') then raise exception 'Invalid review decision'; end if;
  if p_user=auth.uid() then raise exception 'You cannot review your own account'; end if;
  select application_type into v_type from public.profiles where id=p_user and role<>'admin' for update;
  if not found then raise exception 'Applicant not found or cannot be changed'; end if;
  if p_status='approved' then
    update public.profiles set membership_status=p_status,role=v_type where id=p_user;
  else
    update public.profiles set membership_status=p_status where id=p_user;
  end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'membership_'||p_status||'_'||v_type,'profile',p_user);
  if p_status='approved' then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(p_user,'membership','Your InnovateX application was approved','application',p_user);
  end if;
end $$;
revoke all on function public.review_membership(uuid,text) from public,anon;
grant execute on function public.review_membership(uuid,text) to authenticated;

drop policy if exists "Teachers publish courses" on public.courses;
create policy "Teachers publish courses" on public.courses for insert to authenticated
  with check (public.is_teacher());

create table if not exists public.investor_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 3000),
  category text not null default 'Project milestone',
  published boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.investor_inquiries (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null check (char_length(subject) between 3 and 160),
  message text not null check (char_length(message) between 10 and 3000),
  status text not null default 'new' check (status in ('new','reviewed')),
  created_at timestamptz not null default now()
);
create index if not exists investor_inquiries_recent on public.investor_inquiries(created_at desc);
alter table public.investor_updates enable row level security;
alter table public.investor_inquiries enable row level security;
revoke all on public.investor_updates,public.investor_inquiries from anon,authenticated;
grant select on public.investor_updates,public.investor_inquiries to authenticated;
grant insert on public.investor_updates,public.investor_inquiries to authenticated;
grant update(published) on public.investor_updates to authenticated;
grant update(status) on public.investor_inquiries to authenticated;
drop policy if exists "Investor updates for approved investors" on public.investor_updates;
create policy "Investor updates for approved investors" on public.investor_updates for select to authenticated
  using (public.is_admin() or (public.is_investor() and published));
drop policy if exists "Admins publish investor updates" on public.investor_updates;
create policy "Admins publish investor updates" on public.investor_updates for insert to authenticated
  with check (public.is_admin());
drop policy if exists "Admins edit investor updates" on public.investor_updates;
create policy "Admins edit investor updates" on public.investor_updates for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Investors and admins see inquiries" on public.investor_inquiries;
create policy "Investors and admins see inquiries" on public.investor_inquiries for select to authenticated
  using (public.is_admin() or (public.is_investor() and investor_id=(select auth.uid())));
drop policy if exists "Investors submit inquiries" on public.investor_inquiries;
create policy "Investors submit inquiries" on public.investor_inquiries for insert to authenticated
  with check (public.is_investor() and investor_id=(select auth.uid()) and status='new');
drop policy if exists "Admins review investor inquiries" on public.investor_inquiries;
create policy "Admins review investor inquiries" on public.investor_inquiries for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
