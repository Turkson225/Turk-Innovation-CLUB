-- Run after upgrade_membership_collaboration.sql and
-- upgrade_inventory_finance_approvals.sql in the Supabase SQL Editor.
-- Safe to rerun. A quantity edit remains an append-only stock movement.

begin;

-- Announcements are the club alerts published by an administrator.
-- Members retain read access; only an approved administrator can delete one.
grant delete on public.announcements to authenticated;
drop policy if exists "Admins delete announcements" on public.announcements;
create policy "Admins delete announcements" on public.announcements
  for delete to authenticated using ((select public.is_admin()));

-- Keep an administrator action record even after the alert disappears.
create or replace function public.log_deleted_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_id,action,target_type,target_id)
    values (auth.uid(),'announcement_deleted','announcement',old.id);
  return old;
end $$;
revoke all on function public.log_deleted_announcement() from public,anon,authenticated;
drop trigger if exists announcement_deleted_audit on public.announcements;
create trigger announcement_deleted_audit after delete on public.announcements
  for each row execute function public.log_deleted_announcement();

-- Set the in-stock quantity using an audited adjustment. The expected values
-- protect a form opened before another checkout or stock change occurred.
-- Checked-out stock remains unchanged: total and available move together.
create or replace function public.set_inventory_available_quantity(
  p_item uuid,
  p_target_available integer,
  p_expected_total integer,
  p_expected_available integer,
  p_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_available integer;
  v_checked_out bigint;
  v_delta bigint;
  v_note text := trim(p_note);
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_item is null or p_target_available is null or p_target_available < 0
      or p_expected_total is null or p_expected_total < 0
      or p_expected_available is null or p_expected_available < 0 then
    raise exception 'Enter valid inventory quantities';
  end if;
  if v_note is null or char_length(v_note) not between 1 and 2000 then
    raise exception 'Enter a reason for this quantity change';
  end if;

  select quantity_total,quantity_available into v_total,v_available
    from public.inventory_items where id = p_item for update;
  if not found then
    raise exception 'Inventory item not found';
  end if;
  if v_total is distinct from p_expected_total
      or v_available is distinct from p_expected_available then
    raise exception 'Stock changed since you opened this form. Refresh and try again';
  end if;
  if p_target_available = v_available then
    raise exception 'Enter a different in-stock quantity';
  end if;

  v_checked_out := v_total::bigint - v_available::bigint;
  if p_target_available::bigint + v_checked_out > 2147483647 then
    raise exception 'Total stock would exceed the maximum allowed quantity';
  end if;
  v_delta := p_target_available::bigint - v_available::bigint;

  -- The existing admin-only RPC updates both counts and writes a permanent
  -- movement in this same transaction, while this row remains locked.
  return public.record_inventory_movement(
    p_item,
    case when v_delta > 0 then 'add_stock' else 'remove_stock' end,
    abs(v_delta)::integer,
    null,
    v_note
  );
end $$;
revoke all on function public.set_inventory_available_quantity(uuid,integer,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.set_inventory_available_quantity(uuid,integer,integer,integer,text)
  to authenticated;

commit;
