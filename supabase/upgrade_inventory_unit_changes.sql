-- Run after upgrade_inventory_finance_approvals.sql and
-- upgrade_admin_alert_inventory_edits.sql in the Supabase SQL Editor.
-- Existing movement quantities retain their original meaning when an
-- administrator changes an item's measurement unit. Safe to rerun.

begin;

-- Historical stock movements could not have been made in a previous unit:
-- update_inventory_item_catalog blocked unit changes as soon as an item had
-- stock or movement history. Capture that original unit once, before the
-- first conversion. Unit changes for empty items with no stock movements
-- could already exist as zero-quantity update_details rows; their old unit
-- is captured directly from old_details instead.
alter table public.inventory_movements
  add column if not exists unit_at_movement text;

-- If the protection above was bypassed in an older installation, we cannot
-- infer an unsnapshotted quantity's historical unit. Stop instead of
-- silently labelling that quantity with today's unit.
do $$
begin
  if exists (
    select 1
      from public.inventory_movements changed
      join public.inventory_movements stock
        on stock.item_id = changed.item_id
       and stock.created_at <= changed.created_at
       and stock.quantity > 0
       and stock.unit_at_movement is null
     where changed.kind = 'update_details'
       and changed.old_details ? 'unit'
       and changed.new_details ? 'unit'
       and changed.old_details->>'unit' is distinct from changed.new_details->>'unit'
  ) then
    raise exception 'Cannot safely label historical stock units. Review older unit changes before running this migration';
  end if;
end $$;

-- The existing immutable trigger protects all historic ledger fields. Disable
-- only that trigger, inside this transaction and while ALTER TABLE holds its
-- table lock, to fill this new snapshot field; immediately re-enable it.
alter table public.inventory_movements disable trigger inventory_movement_immutable;
update public.inventory_movements m
   set unit_at_movement = case
     when m.kind = 'update_details'
       then coalesce(nullif(trim(m.old_details->>'unit'),''), i.unit)
     else i.unit
   end
  from public.inventory_items i
 where i.id = m.item_id
   and m.unit_at_movement is null;
alter table public.inventory_movements enable trigger inventory_movement_immutable;

alter table public.inventory_movements
  alter column unit_at_movement set not null;
alter table public.inventory_movements
  drop constraint if exists inventory_movement_unit_snapshot_check;
alter table public.inventory_movements
  add constraint inventory_movement_unit_snapshot_check
    check (char_length(trim(unit_at_movement)) between 1 and 30);

-- A regular movement snapshots the item's current unit. A catalog edit
-- snapshots the unit before that edit, which is stored in old_details.
-- In particular, the new unit-change RPC updates the item and then inserts
-- an update_details entry, so its historical snapshot remains the old unit.
create or replace function public.set_inventory_movement_unit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_unit text;
begin
  select unit into v_unit
    from public.inventory_items where id = new.item_id;
  if not found then
    raise exception 'Inventory item not found';
  end if;
  new.unit_at_movement := case
    when new.kind = 'update_details'
      then coalesce(nullif(trim(new.old_details->>'unit'),''),v_unit)
    else v_unit
  end;
  return new;
end $$;
revoke all on function public.set_inventory_movement_unit()
  from public,anon,authenticated;
drop trigger if exists inventory_movement_unit_snapshot on public.inventory_movements;
create trigger inventory_movement_unit_snapshot
  before insert on public.inventory_movements
  for each row execute function public.set_inventory_movement_unit();

-- Unit conversion is an explicit physical recount, not a silent relabel.
-- No outstanding loans may cross the boundary: the existing return RPC
-- compares checkout and return quantities as integers for the same member.
-- Both counts and the reorder level switch atomically, with old/new values
-- and the administrator's reason in the append-only movement history.
create or replace function public.change_inventory_unit(
  p_item uuid,
  p_new_unit text,
  p_new_quantity integer,
  p_new_reorder_level integer,
  p_expected_unit text,
  p_expected_total integer,
  p_expected_available integer,
  p_expected_reorder_level integer,
  p_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old public.inventory_items%rowtype;
  v_unit text := trim(p_new_unit);
  v_note text := trim(p_note);
  v_old_details jsonb;
  v_new_details jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if v_unit is null or char_length(v_unit) not between 1 and 30 then
    raise exception 'Enter a measurement unit between 1 and 30 characters';
  end if;
  if p_new_quantity is null or p_new_quantity < 0
     or p_new_reorder_level is null or p_new_reorder_level < 0 then
    raise exception 'Enter a valid whole-number quantity and reorder level';
  end if;
  if v_note is null or char_length(v_note) not between 1 and 2000 then
    raise exception 'Enter a reason for this unit change and recount';
  end if;

  select * into v_old
    from public.inventory_items where id = p_item for update;
  if not found then
    raise exception 'Inventory item not found';
  end if;
  if v_old.unit is distinct from p_expected_unit
     or v_old.quantity_total is distinct from p_expected_total
     or v_old.quantity_available is distinct from p_expected_available
     or v_old.reorder_level is distinct from p_expected_reorder_level then
    raise exception 'Inventory changed since you opened this form. Refresh and try again';
  end if;
  if v_unit = v_old.unit then
    raise exception 'Enter a different measurement unit';
  end if;
  if v_old.quantity_total <> v_old.quantity_available or exists (
    select 1 from public.inventory_movements
      where item_id = p_item and kind in ('check_out','return')
      group by member_id
      having sum(case when kind = 'check_out' then quantity else -quantity end) <> 0
  ) then
    raise exception 'Return all checked-out stock before changing its unit';
  end if;

  v_old_details := jsonb_build_object(
    'name',v_old.name,'category',v_old.category,'item_type',v_old.item_type,
    'unit',v_old.unit,'reorder_level',v_old.reorder_level,
    'quantity_total',v_old.quantity_total,'quantity_available',v_old.quantity_available,
    'condition',v_old.condition,'location',v_old.location,
    'serial_number',v_old.serial_number
  );
  v_new_details := jsonb_build_object(
    'name',v_old.name,'category',v_old.category,'item_type',v_old.item_type,
    'unit',v_unit,'reorder_level',p_new_reorder_level,
    'quantity_total',p_new_quantity,'quantity_available',p_new_quantity,
    'condition',v_old.condition,'location',v_old.location,
    'serial_number',v_old.serial_number
  );

  update public.inventory_items set
    unit = v_unit, quantity_total = p_new_quantity,
    quantity_available = p_new_quantity,
    reorder_level = p_new_reorder_level, updated_at = now()
    where id = p_item;
  insert into public.inventory_movements
    (item_id,kind,quantity,member_id,note,old_details,new_details,handled_by)
    values (p_item,'update_details',0,null,v_note,v_old_details,v_new_details,auth.uid())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.change_inventory_unit(
  uuid,text,integer,integer,text,integer,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.change_inventory_unit(
  uuid,text,integer,integer,text,integer,integer,integer,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
