-- Run once after upgrade_inventory_finance.sql in the Supabase SQL Editor.
-- All finance entries, including existing ones, await a founder's decision.
-- Inventory and finance history remain append-only; audited changes use RPCs.

begin;

-- Identify parts, tools and other property, and support low-stock alerts in the UI.
alter table public.inventory_items
  add column if not exists item_type text not null default 'other'
    check (item_type in ('component','tool','equipment','consumable','other'));
alter table public.inventory_items
  add column if not exists unit text not null default 'pcs'
    check (char_length(trim(unit)) between 1 and 30);
alter table public.inventory_items
  add column if not exists reorder_level integer not null default 0
    check (reorder_level >= 0);
grant insert(item_type,unit,reorder_level) on public.inventory_items to authenticated;
-- Starting available stock must match total stock; all later differences need
-- an audited checkout or stock movement.
drop policy if exists "Admins register inventory" on public.inventory_items;
create policy "Admins register inventory" on public.inventory_items
  for insert to authenticated with check
    ((select public.is_admin()) and created_by = (select auth.uid())
      and quantity_available = quantity_total);

-- Issued items leave the club's stock permanently. A checkout
-- remains an outstanding loan and must eventually have a matching return.
alter table public.inventory_movements
  drop constraint if exists inventory_movements_kind_check;
alter table public.inventory_movements
  add constraint inventory_movements_kind_check check
    (kind in ('check_out','return','add_stock','remove_stock','issue_stock','update_details'));
alter table public.inventory_movements
  drop constraint if exists inventory_movement_member_kind;
alter table public.inventory_movements
  add constraint inventory_movement_member_kind check (
    (kind in ('check_out','return','issue_stock') and member_id is not null) or
    (kind in ('add_stock','remove_stock','update_details') and member_id is null)
  );

create or replace function public.record_inventory_movement(
  p_item uuid,
  p_kind text,
  p_quantity integer,
  p_member uuid default null,
  p_note text default ''
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_available integer;
  v_condition text;
  v_outstanding bigint;
  v_id uuid;
  v_note text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_kind is null or p_kind not in
      ('check_out','return','add_stock','remove_stock','issue_stock') then
    raise exception 'Invalid inventory movement';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;
  v_note := trim(p_note);
  if v_note is null or char_length(v_note) not between 1 and 2000 then
    raise exception 'Enter a reason for this stock movement';
  end if;

  if p_kind in ('check_out','issue_stock') then
    if p_member is null or not exists (
      select 1 from public.profiles p
      where p.id = p_member and p.membership_status = 'approved'
        and p.role in ('member','teacher','founder','admin')
    ) then
      raise exception 'Select an approved club member';
    end if;
  elsif p_kind = 'return' then
    -- A former borrower may return an existing loan after losing membership.
    if p_member is null then
      raise exception 'Select the original borrower';
    end if;
  elsif p_member is not null then
    raise exception 'Stock adjustments cannot have a member';
  end if;

  select quantity_total,quantity_available,condition
    into v_total,v_available,v_condition
    from public.inventory_items where id = p_item for update;
  if not found then
    raise exception 'Inventory item not found';
  end if;

  if p_kind = 'check_out' then
    if v_condition <> 'good' then
      raise exception 'Only items in good condition can be checked out';
    end if;
    if p_quantity > v_available then
      raise exception 'Not enough stock available';
    end if;
    v_available := v_available - p_quantity;
  elsif p_kind = 'return' then
    select coalesce(sum(case when kind = 'check_out' then quantity else -quantity end),0)
      into v_outstanding from public.inventory_movements
      where item_id = p_item and member_id = p_member
        and kind in ('check_out','return');
    if p_quantity > v_outstanding or p_quantity > v_total - v_available then
      raise exception 'Return exceeds this member''s outstanding checkout';
    end if;
    v_available := v_available + p_quantity;
  elsif p_kind = 'add_stock' then
    v_total := v_total + p_quantity;
    v_available := v_available + p_quantity;
  elsif p_kind = 'remove_stock' then
    if p_quantity > v_available then
      raise exception 'Cannot remove stock that is checked out';
    end if;
    v_total := v_total - p_quantity;
    v_available := v_available - p_quantity;
  elsif p_kind = 'issue_stock' then
    if v_condition <> 'good' then
      raise exception 'Only items in good condition can be issued';
    end if;
    if p_quantity > v_available then
      raise exception 'Not enough stock available';
    end if;
    v_total := v_total - p_quantity;
    v_available := v_available - p_quantity;
  end if;

  update public.inventory_items
    set quantity_total = v_total,quantity_available = v_available,updated_at = now()
    where id = p_item;
  insert into public.inventory_movements(item_id,kind,quantity,member_id,note,handled_by)
    values (p_item,p_kind,p_quantity,p_member,v_note,auth.uid())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_inventory_movement(uuid,text,integer,uuid,text)
  from public,anon,authenticated;
grant execute on function public.record_inventory_movement(uuid,text,integer,uuid,text)
  to authenticated;

-- Every catalog correction captures the full descriptive before/after values.
create or replace function public.update_inventory_item_catalog(
  p_item uuid,
  p_name text,
  p_category text,
  p_item_type text,
  p_unit text,
  p_reorder_level integer,
  p_condition text,
  p_location text,
  p_serial_number text,
  p_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old public.inventory_items%rowtype;
  v_name text := trim(p_name);
  v_category text := trim(p_category);
  v_unit text := trim(p_unit);
  v_location text := coalesce(trim(p_location),'');
  v_serial_number text := nullif(trim(p_serial_number),'');
  v_note text := trim(p_note);
  v_old_details jsonb;
  v_new_details jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'Enter an item name between 2 and 160 characters';
  end if;
  if v_category is null or char_length(v_category) not between 2 and 80 then
    raise exception 'Enter a category between 2 and 80 characters';
  end if;
  if p_item_type is null or p_item_type not in
      ('component','tool','equipment','consumable','other') then
    raise exception 'Select a valid item type';
  end if;
  if v_unit is null or char_length(v_unit) not between 1 and 30 then
    raise exception 'Enter a unit between 1 and 30 characters';
  end if;
  if p_reorder_level is null or p_reorder_level < 0 then
    raise exception 'Reorder level must be zero or more';
  end if;
  if p_condition is null or p_condition not in ('good','needs_repair','retired') then
    raise exception 'Select a valid item condition';
  end if;
  if char_length(v_location) > 160 or char_length(v_serial_number) > 160 then
    raise exception 'Location or serial number is too long';
  end if;
  if v_note is null or char_length(v_note) not between 1 and 2000 then
    raise exception 'Enter a reason for this change';
  end if;

  select * into v_old from public.inventory_items where id = p_item for update;
  if not found then
    raise exception 'Inventory item not found';
  end if;
  if v_unit is distinct from v_old.unit and
      (v_old.quantity_total <> 0 or exists (
        select 1 from public.inventory_movements m where m.item_id = p_item
      )) then
    raise exception 'Unit cannot change once an item has stock or movement history';
  end if;
  v_old_details := jsonb_build_object(
    'name',v_old.name,'category',v_old.category,'item_type',v_old.item_type,
    'unit',v_old.unit,'reorder_level',v_old.reorder_level,
    'condition',v_old.condition,'location',v_old.location,
    'serial_number',v_old.serial_number
  );
  v_new_details := jsonb_build_object(
    'name',v_name,'category',v_category,'item_type',p_item_type,
    'unit',v_unit,'reorder_level',p_reorder_level,
    'condition',p_condition,'location',v_location,
    'serial_number',v_serial_number
  );
  if v_old_details = v_new_details then
    raise exception 'No item details changed';
  end if;

  update public.inventory_items set
    name = v_name,category = v_category,item_type = p_item_type,
    unit = v_unit,reorder_level = p_reorder_level,condition = p_condition,
    location = v_location,serial_number = v_serial_number,updated_at = now()
    where id = p_item;
  insert into public.inventory_movements
    (item_id,kind,quantity,member_id,note,old_details,new_details,handled_by)
    values (p_item,'update_details',0,null,v_note,v_old_details,v_new_details,auth.uid())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.update_inventory_item_catalog(
  uuid,text,text,text,text,integer,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.update_inventory_item_catalog(
  uuid,text,text,text,text,integer,text,text,text,text)
  to authenticated;

-- Historic entries keep their original dates and details, but become pending
-- until a founder reviews them. No existing transaction is silently approved.
alter table public.finance_entries
  add column if not exists approval_required boolean not null default true;
alter table public.finance_entries alter column approval_required set default true;
-- New entries may only provide these fields; approval_required takes its default.
revoke all on public.finance_entries from public,anon,authenticated;
grant select on public.finance_entries to authenticated;
grant insert(entry_type,category,amount,occurred_on,description,counterparty,reference)
  on public.finance_entries to authenticated;

create table if not exists public.finance_reviews (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.finance_entries(id),
  decision text not null check (decision in ('approved','rejected')),
  reviewer_id uuid not null references public.profiles(id),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  constraint finance_rejection_reason check
    (decision <> 'rejected' or char_length(trim(note)) > 0)
);
create index if not exists finance_reviews_recent_idx
  on public.finance_reviews(created_at desc);
alter table public.finance_reviews enable row level security;
revoke all on public.finance_reviews from public,anon,authenticated;
grant select on public.finance_reviews to authenticated;
drop policy if exists "Founders review finance decisions" on public.finance_reviews;
create policy "Founders review finance decisions" on public.finance_reviews
  for select to authenticated using ((select public.is_founder()));
drop trigger if exists finance_review_immutable on public.finance_reviews;
create trigger finance_review_immutable before update or delete on public.finance_reviews
  for each row execute function public.reject_club_ledger_change();

create or replace function public.review_finance_entry(
  p_entry uuid,
  p_decision text,
  p_note text default ''
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.finance_entries%rowtype;
  v_note text := coalesce(trim(p_note),'');
  v_id uuid;
begin
  -- is_founder() also includes administrators, so check the exact role here.
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.membership_status = 'approved' and p.role = 'founder'
  ) then
    raise exception 'Approved founder access required';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Select an approval decision';
  end if;
  if char_length(v_note) > 2000 or
      (p_decision = 'rejected' and v_note = '') then
    raise exception 'Provide a reason for rejection (up to 2000 characters)';
  end if;

  -- Serialize reviewers for an entry; the unique constraint is a second guard.
  select * into v_entry from public.finance_entries where id = p_entry for update;
  if not found then
    raise exception 'Finance entry not found';
  end if;
  if not v_entry.approval_required then
    raise exception 'This entry does not require review';
  end if;
  if v_entry.created_by = auth.uid() then
    raise exception 'You cannot review a transaction you entered';
  end if;
  if exists (select 1 from public.finance_reviews where entry_id = p_entry) then
    raise exception 'This entry has already been reviewed';
  end if;
  insert into public.finance_reviews(entry_id,decision,reviewer_id,note)
    values(p_entry,p_decision,auth.uid(),v_note) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.review_finance_entry(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.review_finance_entry(uuid,text,text)
  to authenticated;

commit;
