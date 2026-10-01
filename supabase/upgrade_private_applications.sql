-- Run after upgrade_approval_emails.sql and upgrade_privacy_requests.sql.
-- Application answers were previously columns on profiles. A member allowed
-- to see a profile row could also SELECT its application_reason despite the UI
-- hiding it. Keep answers in a separate table with its own RLS policies.
-- Do not rerun the older membership / approval migrations after this upgrade.
-- Publish the compatible website before running this migration: the old form
-- writes profiles.application_reason and will stop working once it is removed.

begin;

do $$
begin
  if to_regclass('public.approval_email_history') is null
     or to_regclass('public.approval_email_outbox') is null
     or to_regclass('public.audit_events') is null
     or to_regclass('public.notifications') is null then
    raise exception 'Run upgrade_approval_emails.sql before this migration';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'queue_approval_email_on_approval' and not tgisinternal
  ) then
    raise exception 'Approval email trigger missing; run upgrade_approval_emails.sql first';
  end if;
end $$;

create table if not exists public.application_answers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null,
  updated_at timestamptz not null default now()
);

-- Copy existing nonempty answers without trimming their original wording.
-- Dynamic SQL makes a rerun safe once the original column has been dropped.
do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.profiles'::regclass
       and attname = 'application_reason' and not attisdropped
  ) then
    execute $copy$
      insert into public.application_answers (user_id, reason)
      select p.id, p.application_reason
        from public.profiles p
       where nullif(btrim(p.application_reason), '') is not null
      on conflict (user_id) do nothing
    $copy$;
  end if;
end $$;

alter table public.application_answers enable row level security;
revoke all on public.application_answers from public, anon, authenticated;
grant select, delete on public.application_answers to authenticated;
grant insert (user_id, reason) on public.application_answers to authenticated;
grant update (reason) on public.application_answers to authenticated;
grant select on public.application_answers to service_role;

drop policy if exists "Applicants and admins read answers" on public.application_answers;
create policy "Applicants and admins read answers"
  on public.application_answers for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Applicants submit answers" on public.application_answers;
create policy "Applicants submit answers"
  on public.application_answers for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.membership_status in ('pending', 'rejected')
    )
  );

drop policy if exists "Applicants edit answers" on public.application_answers;
create policy "Applicants edit answers"
  on public.application_answers for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.membership_status in ('pending', 'rejected')
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.membership_status in ('pending', 'rejected')
    )
  );

drop policy if exists "Applicants withdraw answers" on public.application_answers;
create policy "Applicants withdraw answers"
  on public.application_answers for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.membership_status in ('pending', 'rejected')
    )
  );

create or replace function public.touch_application_answer_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.touch_application_answer_updated_at()
  from public, anon, authenticated;
drop trigger if exists touch_application_answer_updated_at on public.application_answers;
create trigger touch_application_answer_updated_at
before update on public.application_answers for each row
execute function public.touch_application_answer_updated_at();

-- Recreate both guards before dropping the profile column. Preserve the
-- existing exception for accounts known to have been approved previously.
create or replace function public.require_complete_application_for_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_status = 'approved'
     and old.membership_status is distinct from 'approved'
     and new.role in ('member', 'teacher', 'founder', 'investor') then
    if not exists (
      select 1 from auth.users u
       where u.id = new.id and u.email_confirmed_at is not null
    ) then
      raise exception 'Applicant must verify their email before approval';
    end if;
    if not exists (
      select 1 from public.application_answers a
       where a.user_id = new.id and nullif(btrim(a.reason), '') is not null
       for share
    ) and not exists (
      select 1 from public.approval_email_history h where h.user_id = new.id
    ) then
      raise exception 'Applicant must submit a reason for joining before approval';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.require_complete_application_for_approval()
  from public, anon, authenticated;

create or replace function public.review_membership(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_type text; v_status text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('approved', 'rejected', 'suspended') then
    raise exception 'Invalid review decision';
  end if;
  if p_user = auth.uid() then raise exception 'You cannot review your own account'; end if;

  select p.application_type, p.membership_status into v_type, v_status
    from public.profiles p where p.id = p_user and p.role <> 'admin' for update;
  if not found then raise exception 'Applicant not found or cannot be changed'; end if;

  if p_status = 'approved' then
    if not exists (
      select 1 from auth.users u
       where u.id = p_user and u.email_confirmed_at is not null
    ) then
      raise exception 'Applicant must verify their email before approval';
    end if;
    if v_status in ('pending', 'rejected')
       and not exists (
         select 1 from public.application_answers a
          where a.user_id = p_user and nullif(btrim(a.reason), '') is not null
          for share
       ) and not exists (
         select 1 from public.approval_email_history h where h.user_id = p_user
       ) then
      raise exception 'Applicant must submit a reason for joining before approval';
    end if;
    update public.profiles set membership_status = 'approved', role = v_type
      where id = p_user;
  else
    update public.profiles set membership_status = p_status where id = p_user;
  end if;

  insert into public.audit_events(actor_id, action, target_type, target_id)
    values (auth.uid(), 'membership_' || p_status || '_' || v_type, 'profile', p_user);
  if p_status = 'approved' then
    insert into public.notifications(user_id, kind, title, target_type, target_id)
      values (p_user, 'membership', 'Your SPACE application was approved',
              'application', p_user);
  end if;
end $$;
revoke all on function public.review_membership(uuid, text) from public, anon;
grant execute on function public.review_membership(uuid, text) to authenticated;

-- All existing SELECT * profile queries now return only directory fields.
-- The DROP also removes the former column-level UPDATE grant. Functions in
-- the installed code have been replaced above; do not rerun their old files.
alter table public.profiles drop column if exists application_reason;

commit;
