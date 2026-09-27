-- Optional read-only access test after upgrade_private_applications.sql.
-- Run in Supabase SQL Editor with at least three existing, distinct accounts:
-- one non-admin with a saved application answer, an approved administrator,
-- and another approved member. This transaction changes no stored data.
-- It simulates each account's JWT claim under the authenticated database role.
-- If those accounts do not yet exist, add test accounts before running it.

begin transaction read only;

do $$
declare v_owner uuid; v_admin uuid; v_other uuid;
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.profiles'::regclass
       and attname = 'application_reason' and not attisdropped
  ) then
    raise exception 'profiles.application_reason is still accessible';
  end if;
  if to_regclass('public.application_answers') is null then
    raise exception 'Run upgrade_private_applications.sql first';
  end if;
  if has_table_privilege('anon', 'public.application_answers', 'SELECT') then
    raise exception 'Anonymous visitors have application-answer SELECT access';
  end if;

  select a.user_id into v_owner
    from public.application_answers a
    join public.profiles p on p.id = a.user_id
   where p.role <> 'admin' and nullif(btrim(a.reason), '') is not null
   order by a.user_id limit 1;
  select id into v_admin from public.profiles
   where membership_status = 'approved' and role = 'admin'
   order by id limit 1;
  select id into v_other from public.profiles
   where membership_status = 'approved'
     and role in ('member', 'teacher', 'founder')
     and id is distinct from v_owner
   order by id limit 1;
  if v_owner is null or v_admin is null or v_other is null then
    raise exception 'Need one non-admin answer owner, another approved member, and one approved admin to verify access';
  end if;
  perform set_config('innovatex_test.owner', v_owner::text, true);
  perform set_config('innovatex_test.admin', v_admin::text, true);
  perform set_config('innovatex_test.other', v_other::text, true);
end $$;

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('innovatex_test.owner'), true);
do $$
begin
  if (select count(*) from public.application_answers
       where user_id = current_setting('innovatex_test.owner')::uuid) <> 1 then
    raise exception 'Applicant cannot read their own saved answer';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('innovatex_test.other'), true);
do $$
begin
  if exists (
    select 1 from public.application_answers
     where user_id = current_setting('innovatex_test.owner')::uuid
  ) then
    raise exception 'Another approved member can read a private application answer';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('innovatex_test.admin'), true);
do $$
begin
  if (select count(*) from public.application_answers
       where user_id = current_setting('innovatex_test.owner')::uuid) <> 1 then
    raise exception 'Administrator cannot read an applicant answer';
  end if;
end $$;

rollback;
