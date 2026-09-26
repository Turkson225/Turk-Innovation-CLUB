-- Run after upgrade_membership_collaboration.sql in the Supabase SQL Editor.
-- Enables instant application notifications in an open administrator tab.
-- The existing notifications RLS policy limits each subscription to its owner.
-- Safe to run again: the table is added to the publication only when absent.

do $$
begin
  if to_regclass('public.notifications') is null then
    raise exception 'Run upgrade_membership_collaboration.sql before this migration';
  end if;
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication is unavailable';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
