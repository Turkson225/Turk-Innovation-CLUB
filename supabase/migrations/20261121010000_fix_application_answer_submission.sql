-- Run after upgrade_private_applications.sql on existing databases.
-- The current form uses an upsert. PostgREST includes both supplied columns
-- (user_id and reason) in its ON CONFLICT DO UPDATE, even for a first insert.
begin;

-- Keep ownership immutable even when an upsert writes the existing ID back.
-- The applicant-only INSERT and UPDATE policies continue to restrict writes
-- to the caller's own pending or rejected application.
create or replace function public.touch_application_answer_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Application answer ownership cannot be changed'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

grant update (user_id) on public.application_answers to authenticated;

commit;
