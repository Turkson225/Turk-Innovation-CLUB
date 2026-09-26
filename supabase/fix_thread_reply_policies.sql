-- Run once in Supabase SQL Editor after upgrade_media_threads.sql.
-- Correct correlated row references in both reply INSERT policies.
-- This changes policies only; existing posts, comments and messages are preserved.

begin;

drop policy if exists "Members send messages" on public.channel_messages;
create policy "Members send messages" on public.channel_messages for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and (parent_id is null or exists(select 1 from public.channel_messages parent
      where parent.id=channel_messages.parent_id
        and parent.channel_id=channel_messages.channel_id
        and parent.parent_id is null))
    and (document_id is null or exists(select 1 from public.documents d
      where d.id=channel_messages.document_id
        and d.channel_id=channel_messages.channel_id
        and d.author_id=(select auth.uid())))
    and (image_path is null or split_part(image_path,'/',1)=(select auth.uid()::text)));

drop policy if exists "Members comment on visible posts" on public.activity_comments;
create policy "Members comment on visible posts" on public.activity_comments for insert to authenticated
  with check (public.is_approved() and author_id=(select auth.uid())
    and exists(select 1 from public.activity_posts p
      where p.id=activity_comments.post_id and p.deleted_at is null)
    and (parent_id is null or exists(select 1 from public.activity_comments c
      where c.id=activity_comments.parent_id
        and c.post_id=activity_comments.post_id
        and c.parent_id is null)));

commit;
