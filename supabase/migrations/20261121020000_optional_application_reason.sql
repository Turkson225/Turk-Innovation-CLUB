-- Run after the private application and application answer submission fixes.
-- A reason for joining is optional; verified email and administrator approval
-- are still required. Keeping the existing trigger also protects other paths
-- that approve an account, such as accepting a founder invitation.
begin;

create or replace function public.require_complete_application_for_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_status = 'approved'
     and old.membership_status is distinct from 'approved'
     and new.role in ('member', 'teacher', 'founder', 'investor')
     and not exists (
       select 1 from auth.users u
        where u.id = new.id and u.email_confirmed_at is not null
     ) then
    raise exception 'Applicant must verify their email before approval';
  end if;
  return new;
end $$;

create or replace function public.review_membership(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_type text;
begin
  -- SPACE_MFA_ENTRY_GUARD
  -- Older installations may not have applied the optional hardening upgrade.
  if pg_catalog.to_regprocedure('public.space_require_recent_admin_mfa()') is not null then
    perform public.space_require_recent_admin_mfa();
  end if;
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status is null or p_status not in ('approved', 'rejected', 'suspended') then
    raise exception 'Invalid review decision';
  end if;
  if p_user = (select auth.uid()) then raise exception 'You cannot review your own account'; end if;

  select p.application_type into v_type
    from public.profiles p where p.id = p_user and p.role <> 'admin' for update;
  if not found then raise exception 'Applicant not found or cannot be changed'; end if;

  if p_status = 'approved' then
    if not exists (
      select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null
    ) then
      raise exception 'Applicant must verify their email before approval';
    end if;
    update public.profiles set membership_status = 'approved', role = v_type
      where id = p_user;
  else
    update public.profiles set membership_status = p_status where id = p_user;
  end if;

  insert into public.audit_events(actor_id, action, target_type, target_id)
    values ((select auth.uid()), 'membership_' || p_status || '_' || v_type, 'profile', p_user);
  if p_status = 'approved' then
    insert into public.notifications(user_id, kind, title, target_type, target_id)
      values (p_user, 'membership', 'Your SPACE application was approved', 'application', p_user);
  end if;
end $$;

revoke all on function public.require_complete_application_for_approval() from public, anon, authenticated;
revoke all on function public.review_membership(uuid, text) from public, anon;
grant execute on function public.review_membership(uuid, text) to authenticated;

commit;
