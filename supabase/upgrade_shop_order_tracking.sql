-- Run this entire file after upgrade_club_shop.sql (and product alerts, if enabled).
-- Processing / Ready / Delivered labels retain existing stored order states and history.
-- Purchase receipts require administrator-confirmed full payment and handover.
begin;
do $$ begin
 if to_regclass('public.space_shop_orders') is null then raise exception 'Run upgrade_club_shop.sql first';end if;
end $$;

create table if not exists public.space_shop_receipts(
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.space_shop_orders(id),
 buyer_id uuid not null references public.profiles(id),receipt_number text not null unique,order_ref text not null,
 seller_name text not null default 'TURK INNOVATION CLUB',buyer_name text not null,buyer_phone text not null,
 total_cents bigint not null check(total_cents>0),currency text not null check(currency='GHS'),
 payment_reference text not null check(length(trim(payment_reference)) between 3 and 160),
 paid_at timestamptz not null,issued_at timestamptz not null default now(),issued_by uuid references public.profiles(id),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)>0)
);
alter table public.space_shop_receipts enable row level security;
revoke all on public.space_shop_receipts from public,anon,authenticated;
grant select on public.space_shop_receipts to authenticated;
drop policy if exists shop_receipt_read on public.space_shop_receipts;
create policy shop_receipt_read on public.space_shop_receipts for select to authenticated
 using(buyer_id=(select auth.uid()) or (select public.is_admin()));
drop trigger if exists shop_receipts_immutable on public.space_shop_receipts;
create trigger shop_receipts_immutable before update or delete on public.space_shop_receipts
 for each row execute function public.reject_club_ledger_change();

-- Trigger/private worker only. Authenticated clients cannot manufacture receipt snapshots.
create or replace function public.space_shop_record_receipt(p_order uuid,p_notify boolean default true)
 returns uuid language plpgsql security definer set search_path='' as $$
declare v_order public.space_shop_orders%rowtype;v_id uuid;v_actor uuid;v_items jsonb;begin
 select * into v_order from public.space_shop_orders where id=p_order for update;
 if not found or v_order.status<>'collected' or v_order.payment_status<>'paid'
  or length(trim(coalesce(v_order.payment_reference,'')))<3 then
  raise exception 'Record full payment and delivery before issuing a purchase receipt';end if;
 select id into v_id from public.space_shop_receipts where order_id=p_order;
 if found then return v_id;end if;
 v_actor:=auth.uid();
 if v_actor is null then select actor_id into v_actor from public.space_shop_order_events
  where order_id=p_order and status='collected' order by created_at desc,id desc limit 1;end if;
 select jsonb_agg(jsonb_build_object('product_title',i.product_title,'variant_label',i.variant_label,'sku',i.sku,
  'quantity',i.quantity,'unit',i.unit,'unit_price_cents',i.unit_price_cents,'line_total_cents',i.line_total_cents) order by i.id)
  into v_items from public.space_shop_order_items i where i.order_id=p_order;
 if v_items is null then raise exception 'Order items are required for a purchase receipt';end if;
 insert into public.space_shop_receipts(order_id,buyer_id,receipt_number,order_ref,buyer_name,buyer_phone,total_cents,currency,payment_reference,paid_at,issued_by,items)
 values(p_order,v_order.buyer_id,'TIC-R-'||v_order.order_ref,v_order.order_ref,v_order.contact_name,v_order.contact_phone,
  v_order.total_cents,v_order.currency,v_order.payment_reference,coalesce(v_order.collected_at,now()),v_actor,v_items)
 on conflict(order_id) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.space_shop_receipts where order_id=p_order;
 elsif p_notify then
  insert into public.notifications(user_id,kind,title,target_type,target_id)
   values(v_order.buyer_id,'shop_order','Purchase receipt ready: '||v_order.order_ref,'shop_order',p_order);
 end if;
 return v_id;
end $$;
revoke all on function public.space_shop_record_receipt(uuid,boolean) from public,anon,authenticated;

create or replace function public.space_shop_receipt_after_delivery() returns trigger
 language plpgsql security definer set search_path='' as $$ begin
 if new.status='collected' and new.payment_status='paid' then perform public.space_shop_record_receipt(new.id,true);end if;
 return new;
end $$;
revoke all on function public.space_shop_receipt_after_delivery() from public,anon,authenticated;
drop trigger if exists shop_receipt_after_delivery on public.space_shop_orders;
create trigger shop_receipt_after_delivery after update of status,payment_status on public.space_shop_orders
 for each row execute function public.space_shop_receipt_after_delivery();

create or replace function public.space_shop_order_receipt(p_order uuid) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select to_jsonb(r)-array['buyer_id','issued_by'] from public.space_shop_receipts r where r.order_id=p_order
$$;
revoke all on function public.space_shop_order_receipt(uuid) from public,anon;
grant execute on function public.space_shop_order_receipt(uuid) to authenticated;

create or replace function public.space_shop_send_receipt(p_order uuid,p_note text default 'Your purchase receipt is ready. Thank you for shopping with the club.')
 returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_receipt public.space_shop_receipts%rowtype;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_note is null or length(trim(p_note)) not between 3 and 1000 then raise exception 'Add a receipt note of 3 to 1000 characters';end if;
 v_id:=public.space_shop_record_receipt(p_order,false);
 select * into v_receipt from public.space_shop_receipts where id=v_id;
 insert into public.space_shop_order_events(order_id,actor_id,status,note)
  values(p_order,auth.uid(),'receipt','Purchase receipt '||v_receipt.receipt_number||': '||trim(p_note));
 insert into public.notifications(user_id,kind,title,target_type,target_id)
  values(v_receipt.buyer_id,'shop_order','Purchase receipt: '||v_receipt.receipt_number,'shop_order',p_order);
 return v_id;
end $$;
revoke all on function public.space_shop_send_receipt(uuid,text) from public,anon;
grant execute on function public.space_shop_send_receipt(uuid,text) to authenticated;

create or replace function public.space_shop_order_action(p_order uuid,p_status text,p_note text,p_payment_reference text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_order public.space_shop_orders%rowtype;v_row record;v_finance uuid;v_admin boolean:=public.is_admin();v_public_status text;begin
 p_status:=case p_status when 'processing' then 'confirmed' when 'delivered' then 'collected' else p_status end;
 v_public_status:=case p_status when 'confirmed' then 'Processing' when 'collected' then 'Delivered' else initcap(p_status) end;
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select * into v_order from public.space_shop_orders where id=p_order for update;
 if not found or not v_admin and v_order.buyer_id<>auth.uid() then raise exception 'Order unavailable';end if;
 if not v_admin and p_status<>'cancelled' then raise exception 'Administrator access required';end if;
 if p_status is null or p_status not in ('confirmed','ready','collected','cancelled') or p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Choose a valid update and a note';end if;
 if v_order.status=p_status then return;end if;
 if v_order.status in ('collected','cancelled') then raise exception 'This completed order cannot be changed. Contact the administrator for support.';end if;
 if v_order.status='ready' and p_status='confirmed' then raise exception 'A ready order cannot move backwards';end if;
 if p_status='collected' and (p_payment_reference is null or length(trim(p_payment_reference)) not between 3 and 160) then raise exception 'Confirm receipt of payment and add a payment reference';end if;
 if p_status in ('cancelled','collected') then
  perform 1 from public.space_shop_variants v where v.id in(select variant_id from public.space_shop_order_items where order_id=p_order) order by v.id for update;
  for v_row in select v.*,i.quantity from public.space_shop_order_items i join public.space_shop_variants v on v.id=i.variant_id where i.order_id=p_order order by v.id loop
   if v_row.reserved<v_row.quantity then raise exception 'Stock reservation needs administrator review';end if;
   update public.space_shop_variants set reserved=reserved-v_row.quantity,on_hand=on_hand-case when p_status='collected' then v_row.quantity else 0 end,updated_at=now() where id=v_row.id;
   insert into public.space_shop_stock_moves(variant_id,order_id,kind,stock_delta,reserved_delta,on_hand_after,reserved_after,note,actor_id) values(v_row.id,p_order,case when p_status='collected' then 'collected' else 'released' end,case when p_status='collected' then -v_row.quantity else 0 end,-v_row.quantity,v_row.on_hand-case when p_status='collected' then v_row.quantity else 0 end,v_row.reserved-v_row.quantity,trim(p_note),auth.uid());
  end loop;
 end if;
 if p_status='collected' then
  insert into public.finance_entries(entry_type,category,amount,description,counterparty,reference,created_by)
   values('income','Club shop',v_order.total_cents::numeric/100,'Purchase payment for '||v_order.order_ref,v_order.contact_name,trim(p_payment_reference),auth.uid()) returning id into v_finance;
 end if;
 update public.space_shop_orders set status=p_status,updated_at=now(),payment_status=case when p_status='collected' then 'paid' else payment_status end,
  payment_reference=case when p_status='collected' then trim(p_payment_reference) else payment_reference end,
  finance_entry_id=coalesce(v_finance,finance_entry_id),collected_at=case when p_status='collected' then now() else collected_at end where id=p_order;
 insert into public.space_shop_order_events(order_id,actor_id,status,note) values(p_order,auth.uid(),p_status,trim(p_note));
 insert into public.notifications(user_id,kind,title,target_type,target_id) values(v_order.buyer_id,'shop_order',v_order.order_ref||': '||v_public_status,'shop_order',p_order);
 insert into public.notifications(user_id,kind,title,target_type,target_id) select id,'shop_order',v_order.order_ref||': '||v_public_status,'shop_order',p_order from public.profiles where role='admin' and membership_status='approved' and id<>auth.uid() and id<>v_order.buyer_id;
end $$;

-- Historical paid orders receive stable receipt snapshots without notification spam.
do $$ declare v_id uuid;begin
 for v_id in select id from public.space_shop_orders where status='collected' and payment_status='paid'
  and length(trim(coalesce(payment_reference,''))) between 3 and 160 order by created_at,id
 loop perform public.space_shop_record_receipt(v_id,false);end loop;
end $$;
notify pgrst,'reload schema';
commit;
