-- Run once after upgrade_membership_collaboration.sql in Supabase SQL Editor.
-- Member-only activity feed with posts, comments, likes and moderation.

create table public.activity_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  link_url text check (link_url is null or link_url ~ '^https://'),
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index activity_posts_recent on public.activity_posts(created_at desc);
create table public.activity_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.activity_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index activity_comments_post on public.activity_comments(post_id,created_at);
create table public.activity_likes (
  post_id uuid not null references public.activity_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
alter table public.activity_posts enable row level security;
alter table public.activity_comments enable row level security;
alter table public.activity_likes enable row level security;
revoke all on public.activity_posts,public.activity_comments,public.activity_likes from anon,authenticated;
grant select,insert on public.activity_posts,public.activity_comments,public.activity_likes to authenticated;
grant delete on public.activity_likes to authenticated;

create policy "Approved members read feed" on public.activity_posts for select to authenticated
  using (public.is_approved() and deleted_at is null);
create policy "Members create own posts" on public.activity_posts for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid()) and deleted_at is null
    and (document_id is null or exists(select 1 from public.documents d where d.id=document_id and d.hidden_at is null)));
create policy "Approved members read feed comments" on public.activity_comments for select to authenticated
  using (public.is_approved() and exists(select 1 from public.activity_posts p where p.id=post_id and p.deleted_at is null));
create policy "Members comment on visible posts" on public.activity_comments for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and exists(select 1 from public.activity_posts p where p.id=post_id and p.deleted_at is null));
create policy "Approved members read feed likes" on public.activity_likes for select to authenticated
  using (public.is_approved() and exists(select 1 from public.activity_posts p where p.id=post_id and p.deleted_at is null));
create policy "Members like visible posts" on public.activity_likes for insert to authenticated
  with check (public.is_approved() and user_id=(select auth.uid())
    and exists(select 1 from public.activity_posts p where p.id=post_id and p.deleted_at is null));
create policy "Members unlike own likes" on public.activity_likes for delete to authenticated
  using (public.is_approved() and user_id=(select auth.uid()));

create or replace function public.edit_activity_post(p_id uuid,p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() or char_length(trim(p_body)) not between 1 and 3000 then
    raise exception 'Invalid post'; end if;
  update public.activity_posts set body=trim(p_body),edited_at=now()
    where id=p_id and author_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'Post cannot be edited'; end if;
end $$;
create or replace function public.remove_activity_post(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then raise exception 'Membership required'; end if;
  update public.activity_posts set body='[Post removed]',link_url=null,document_id=null,deleted_at=now()
    where id=p_id and deleted_at is null and (author_id=auth.uid() or public.is_admin());
  if not found then raise exception 'Post cannot be removed'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'post_removed','post',p_id);
end $$;
revoke all on function public.edit_activity_post(uuid,text),public.remove_activity_post(uuid) from public,anon;
grant execute on function public.edit_activity_post(uuid,text),public.remove_activity_post(uuid) to authenticated;

create or replace function public.notify_activity_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select author_id into v_author from public.activity_posts where id=new.post_id and deleted_at is null;
  if v_author is not null and v_author<>new.author_id then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(v_author,'comment','Someone commented on your post','post',new.post_id);
  end if;
  return new;
end $$;
create trigger on_activity_comment after insert on public.activity_comments
  for each row execute function public.notify_activity_comment();

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('message','document','news','post'));
create or replace function public.moderate_content(p_type text,p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_type='message' then
    update public.channel_messages set body='[Message removed]',deleted_at=now() where id=p_id and deleted_at is null;
  elsif p_type='document' then
    update public.documents set hidden_at=now() where id=p_id and hidden_at is null;
  elsif p_type='news' then
    update public.news_posts set status='rejected' where id=p_id and status<>'rejected';
  elsif p_type='post' then
    update public.activity_posts set body='[Post removed]',link_url=null,document_id=null,deleted_at=now()
      where id=p_id and deleted_at is null;
  else raise exception 'Invalid content type'; end if;
  if not found then raise exception 'Content not found'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'content_removed',p_type,p_id);
end $$;
