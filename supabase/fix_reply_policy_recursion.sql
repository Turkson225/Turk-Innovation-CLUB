-- Run in Supabase SQL Editor after fix_thread_reply_policies.sql.
-- The earlier INSERT policies read their own tables to validate reply parents.
-- Postgres evaluates row security on that self-query and reports infinite recursion.
-- SECURITY DEFINER helpers validate only the parent relationship while preserving
-- the existing approved-member, author, document and image checks.

begin;

create or replace function public.valid_activity_comment_parent(p_parent uuid, p_post uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.activity_comments c
    where c.id = p_parent and c.post_id = p_post and c.parent_id is null
  );
$$;
revoke all on function public.valid_activity_comment_parent(uuid,uuid) from public,anon;
grant execute on function public.valid_activity_comment_parent(uuid,uuid) to authenticated;

create or replace function public.valid_channel_reply_parent(p_parent uuid, p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.channel_messages m
    where m.id = p_parent and m.channel_id = p_channel and m.parent_id is null
  );
$$;
revoke all on function public.valid_channel_reply_parent(uuid,uuid) from public,anon;
grant execute on function public.valid_channel_reply_parent(uuid,uuid) to authenticated;

drop policy if exists "Members comment on visible posts" on public.activity_comments;
create policy "Members comment on visible posts" on public.activity_comments for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and exists(select 1 from public.activity_posts p
      where p.id=activity_comments.post_id and p.deleted_at is null)
    and (parent_id is null or public.valid_activity_comment_parent(parent_id,post_id)));

drop policy if exists "Members send messages" on public.channel_messages;
create policy "Members send messages" on public.channel_messages for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and (parent_id is null or public.valid_channel_reply_parent(parent_id,channel_id))
    and (document_id is null or exists(select 1 from public.documents d
      where d.id=channel_messages.document_id
        and d.channel_id=channel_messages.channel_id
        and d.author_id=(select auth.uid())))
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));

commit;
