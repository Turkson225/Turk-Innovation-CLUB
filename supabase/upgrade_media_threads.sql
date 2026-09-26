-- Run once after upgrade_direct_messages.sql in Supabase SQL Editor.
-- Adds image-led feed posts, one-level comment threads and private channel images.

alter table public.activity_posts add column if not exists title text not null default ''
  check (char_length(title) <= 180);
alter table public.activity_posts add column if not exists category text not null default 'Project update'
  check (category in ('Project update','Technology','Build log','Question','Opportunity'));
alter table public.activity_posts add column if not exists image_path text;
alter table public.channel_messages add column if not exists image_path text;
alter table public.direct_messages add column if not exists image_path text;
alter table public.activity_comments add column if not exists parent_id uuid references public.activity_comments(id) on delete cascade;
create index if not exists activity_comments_parent on public.activity_comments(parent_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('club-media','club-media',false,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

create policy "Approved members upload club images" on storage.objects for insert to authenticated
  with check (bucket_id='club-media' and public.is_approved()
    and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "Approved members see shared club images" on storage.objects for select to authenticated
  using (bucket_id='club-media' and public.is_approved() and (
    (storage.foldername(name))[1]=(select auth.uid()::text)
    or exists(select 1 from public.activity_posts p where p.image_path=name and p.deleted_at is null)
    or exists(select 1 from public.channel_messages m where m.image_path=name and m.deleted_at is null)
    or exists(select 1 from public.direct_messages dm where dm.image_path=name
      and (dm.sender_id=(select auth.uid()) or dm.recipient_id=(select auth.uid())))));
create policy "Members remove own club images" on storage.objects for delete to authenticated
  using (bucket_id='club-media' and public.is_approved()
    and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists "Members create own posts" on public.activity_posts;
create policy "Members create own posts" on public.activity_posts for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid()) and deleted_at is null
    and (document_id is null or exists(select 1 from public.documents d where d.id=document_id and d.hidden_at is null))
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));
drop policy if exists "Members send messages" on public.channel_messages;
create policy "Members send messages" on public.channel_messages for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and (parent_id is null or exists(select 1 from public.channel_messages parent where parent.id=parent_id and parent.channel_id=channel_id and parent.parent_id is null))
    and (document_id is null or exists(select 1 from public.documents d where d.id=document_id and d.channel_id=channel_id and d.author_id=(select auth.uid())))
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));
drop policy if exists "Members send direct messages to approved members" on public.direct_messages;
create policy "Members send direct messages to approved members" on public.direct_messages for insert to authenticated
  with check (public.is_approved() and sender_id=(select auth.uid())
    and exists(select 1 from public.profiles p where p.id=recipient_id and p.membership_status='approved')
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));
drop policy if exists "Members comment on visible posts" on public.activity_comments;
create policy "Members comment on visible posts" on public.activity_comments for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and exists(select 1 from public.activity_posts p where p.id=post_id and p.deleted_at is null)
    and (parent_id is null or exists(select 1 from public.activity_comments c
      where c.id=parent_id and c.post_id=post_id and c.parent_id is null)));

create or replace function public.notify_activity_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_parent_author uuid;
begin
  select author_id into v_author from public.activity_posts where id=new.post_id and deleted_at is null;
  if new.parent_id is not null then
    select author_id into v_parent_author from public.activity_comments where id=new.parent_id;
  end if;
  if v_author is not null and v_author<>new.author_id then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(v_author,'comment','Someone commented on your post','post',new.post_id);
  end if;
  if v_parent_author is not null and v_parent_author<>new.author_id and v_parent_author is distinct from v_author then
    insert into public.notifications(user_id,kind,title,target_type,target_id)
      values(v_parent_author,'reply','Someone replied to your comment','post',new.post_id);
  end if;
  return new;
end $$;

create or replace function public.edit_activity_post_details(p_id uuid,p_body text,p_title text,p_category text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() or char_length(trim(p_body)) not between 1 and 3000
     or char_length(coalesce(p_title,'')) > 180
     or p_category not in ('Project update','Technology','Build log','Question','Opportunity') then
    raise exception 'Invalid post'; end if;
  update public.activity_posts set body=trim(p_body),title=trim(coalesce(p_title,'')),category=p_category,edited_at=now()
    where id=p_id and author_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'Post cannot be edited'; end if;
end $$;
revoke all on function public.edit_activity_post_details(uuid,text,text,text) from public,anon;
grant execute on function public.edit_activity_post_details(uuid,text,text,text) to authenticated;

create or replace function public.remove_channel_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then raise exception 'Membership required'; end if;
  update public.channel_messages set body='[Message removed]',image_path=null,deleted_at=now()
    where id=p_id and deleted_at is null and (author_id=auth.uid() or public.is_admin());
  if not found then raise exception 'Message cannot be removed'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'message_removed','channel_message',p_id);
end $$;
create or replace function public.remove_activity_post(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then raise exception 'Membership required'; end if;
  update public.activity_posts set body='[Post removed]',link_url=null,document_id=null,image_path=null,deleted_at=now()
    where id=p_id and deleted_at is null and (author_id=auth.uid() or public.is_admin());
  if not found then raise exception 'Post cannot be removed'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'post_removed','post',p_id);
end $$;
create or replace function public.moderate_content(p_type text,p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_type='message' then
    update public.channel_messages set body='[Message removed]',image_path=null,deleted_at=now() where id=p_id and deleted_at is null;
  elsif p_type='document' then
    update public.documents set hidden_at=now() where id=p_id and hidden_at is null;
  elsif p_type='news' then
    update public.news_posts set status='rejected' where id=p_id and status<>'rejected';
  elsif p_type='post' then
    update public.activity_posts set body='[Post removed]',link_url=null,document_id=null,image_path=null,deleted_at=now()
      where id=p_id and deleted_at is null;
  else raise exception 'Invalid content type'; end if;
  if not found then raise exception 'Content not found'; end if;
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values(auth.uid(),'content_removed',p_type,p_id);
end $$;
