-- Run after upgrade_roles_investors.sql in the Supabase SQL Editor.
-- Inventory is visible to approved club members; stock and finance writes are admin-only.
-- Financial entries and stock movements are permanent ledger records.

begin;

do $$
begin
  if to_regclass('public.finance_reviews') is not null then
    raise exception 'Do not rerun the base inventory migration after the approvals upgrade';
  end if;
end $$;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  category text not null check (char_length(trim(category)) between 2 and 80),
  quantity_total integer not null default 0 check (quantity_total >= 0),
  quantity_available integer not null default 0 check (quantity_available >= 0 and quantity_available <= quantity_total),
  condition text not null default 'good' check (condition in ('good','needs_repair','retired')),
  location text not null default '' check (char_length(location) <= 160),
  serial_number text check (serial_number is null or char_length(serial_number) <= 160),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  kind text not null check (kind in ('check_out','return','add_stock','remove_stock','update_details')),
  quantity integer not null check (
    (kind = 'update_details' and quantity = 0) or
    (kind <> 'update_details' and quantity > 0)
  ),
  member_id uuid references public.profiles(id),
  note text not null check (char_length(trim(note)) between 1 and 2000),
  old_details jsonb,
  new_details jsonb,
  handled_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint inventory_movement_member_kind check (
    (kind in ('check_out','return') and member_id is not null) or
    (kind in ('add_stock','remove_stock','update_details') and member_id is null)
  ),
  constraint inventory_movement_detail_audit check (
    (kind = 'update_details' and old_details is not null and new_details is not null
      and char_length(trim(note)) > 0) or
    (kind <> 'update_details' and old_details is null and new_details is null)
  )
);

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income','expense')),
  category text not null check (char_length(trim(category)) between 2 and 80),
  amount numeric(12,2) not null check (amount > 0),
  occurred_on date not null default current_date,
  description text not null check (char_length(trim(description)) between 1 and 2000),
  counterparty text not null default '' check (char_length(counterparty) <= 160),
  reference text not null default '' check (char_length(reference) <= 160),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_items_category_idx
  on public.inventory_items(category,name);
create index if not exists inventory_movements_item_recent_idx
  on public.inventory_movements(item_id,created_at desc);
create index if not exists inventory_movements_member_recent_idx
  on public.inventory_movements(member_id,created_at desc);
create index if not exists finance_entries_date_idx
  on public.finance_entries(occurred_on desc,created_at desc);

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.finance_entries enable row level security;

revoke all on public.inventory_items,public.inventory_movements,public.finance_entries
  from public,anon,authenticated;
grant select on public.inventory_items to authenticated;
grant insert(name,category,quantity_total,quantity_available,condition,location,serial_number)
  on public.inventory_items to authenticated;
grant select on public.inventory_movements to authenticated;
grant select on public.finance_entries to authenticated;
grant insert(entry_type,category,amount,occurred_on,description,counterparty,reference)
  on public.finance_entries to authenticated;

drop policy if exists "Approved club members view inventory" on public.inventory_items;
create policy "Approved club members view inventory" on public.inventory_items
  for select to authenticated using ((select public.is_approved()));
drop policy if exists "Admins register inventory" on public.inventory_items;
create policy "Admins register inventory" on public.inventory_items
  for insert to authenticated with check
    ((select public.is_admin()) and created_by = (select auth.uid()));

drop policy if exists "Founders review inventory movements" on public.inventory_movements;
create policy "Founders review inventory movements" on public.inventory_movements
  for select to authenticated using ((select public.is_founder()));

drop policy if exists "Founders review finance" on public.finance_entries;
create policy "Founders review finance" on public.finance_entries
  for select to authenticated using ((select public.is_founder()));
drop policy if exists "Admins record finance" on public.finance_entries;
create policy "Admins record finance" on public.finance_entries
  for insert to authenticated with check
    ((select public.is_admin()) and created_by = (select auth.uid()));

-- Lock the item so concurrent checkouts, returns and stock changes cannot overdraw it.
-- Returns must be for an existing outstanding checkout by the same member.
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
  if p_kind is null or p_kind not in ('check_out','return','add_stock','remove_stock') then
    raise exception 'Invalid inventory movement';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;
  v_note := trim(p_note);
  if v_note is null or char_length(v_note) not between 1 and 2000 then
    raise exception 'Enter a reason for this stock movement';
  end if;
  if p_kind = 'check_out' then
    if p_member is null or not exists (
      select 1 from public.profiles p
      where p.id = p_member and p.membership_status = 'approved'
        and p.role in ('member','teacher','founder','admin')
    ) then
      raise exception 'Select an approved club member';
    end if;
  elsif p_kind = 'return' then
    -- A suspended/rejected former borrower can still return their own checkout.
    if p_member is null then
      raise exception 'Select the original borrower';
    end if;
  elsif p_member is not null then
    raise exception 'Stock adjustments cannot have a member';
  end if;

  select quantity_total,quantity_available,condition into v_total,v_available,v_condition
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
      where item_id = p_item and member_id = p_member and kind in ('check_out','return');
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
  end if;

  update public.inventory_items
    set quantity_total = v_total, quantity_available = v_available, updated_at = now()
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

-- Correct descriptive details without granting direct UPDATE on inventory_items.
-- The reason and before/after values are written in the same transaction.
create or replace function public.update_inventory_item_details(
  p_item uuid,
  p_name text,
  p_category text,
  p_condition text,
  p_location text,
  p_serial_number text,
  p_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old public.inventory_items%rowtype;
  v_name text;
  v_category text;
  v_location text;
  v_serial_number text;
  v_note text;
  v_old_details jsonb;
  v_new_details jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  v_name := trim(p_name);
  v_category := trim(p_category);
  v_location := coalesce(trim(p_location),'');
  v_serial_number := nullif(trim(p_serial_number),'');
  v_note := trim(p_note);
  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'Enter an item name between 2 and 160 characters';
  end if;
  if v_category is null or char_length(v_category) not between 2 and 80 then
    raise exception 'Enter a category between 2 and 80 characters';
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
  v_old_details := jsonb_build_object(
    'name',v_old.name,'category',v_old.category,'condition',v_old.condition,
    'location',v_old.location,'serial_number',v_old.serial_number
  );
  v_new_details := jsonb_build_object(
    'name',v_name,'category',v_category,'condition',p_condition,
    'location',v_location,'serial_number',v_serial_number
  );
  if v_old_details = v_new_details then
    raise exception 'No item details changed';
  end if;

  update public.inventory_items set
    name = v_name, category = v_category, condition = p_condition,
    location = v_location, serial_number = v_serial_number, updated_at = now()
    where id = p_item;
  insert into public.inventory_movements
    (item_id,kind,quantity,member_id,note,old_details,new_details,handled_by)
    values (p_item,'update_details',0,null,v_note,v_old_details,v_new_details,auth.uid())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.update_inventory_item_details(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.update_inventory_item_details(uuid,text,text,text,text,text,text)
  to authenticated;

-- Preserve the two audit ledgers even if table grants are changed later.
create or replace function public.reject_club_ledger_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Ledger records are append-only';
end $$;
revoke all on function public.reject_club_ledger_change() from public,anon,authenticated;
drop trigger if exists inventory_movement_immutable on public.inventory_movements;
create trigger inventory_movement_immutable before update or delete on public.inventory_movements
  for each row execute function public.reject_club_ledger_change();
drop trigger if exists finance_entry_immutable on public.finance_entries;
create trigger finance_entry_immutable before update or delete on public.finance_entries
  for each row execute function public.reject_club_ledger_change();

commit;
