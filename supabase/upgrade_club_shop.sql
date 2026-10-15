-- Run the entire file after upgrade_officer_workspaces_finance.sql.
-- Member shop: GHS, collection orders, stock reservations and admin-controlled payment recording.
begin;
do $$ begin
 if to_regclass('public.finance_monthly_reviews') is null then raise exception 'Run officer workspaces and finance migration first';end if;
end $$;
create table if not exists public.space_shop_settings(
 singleton boolean primary key default true check(singleton),is_open boolean not null default true,
 collection_note text not null default 'The club administrator will confirm your collection details after ordering.',
 contact_note text not null default 'Contact a club administrator about collection or an existing order.',
 policy_note text not null default 'You can cancel before collection. For questions or an issue after collection, contact the club administrator.',
 updated_at timestamptz not null default now()
);
insert into public.space_shop_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.space_shop_products(
 id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title)) between 2 and 160),
 category text not null check(category in ('Merchandise','Components','Kits','Tools & accessories','Other')),
 description text not null check(length(trim(description)) between 10 and 5000),image_path text,
 published boolean not null default false,archived boolean not null default false,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.space_shop_variants(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.space_shop_products(id),
 sku text not null unique check(length(sku) between 2 and 60),label text not null check(length(trim(label)) between 1 and 100),
 price_cents bigint not null check(price_cents between 1 and 100000000),unit text not null default 'pcs' check(length(trim(unit)) between 1 and 30),
 on_hand integer not null default 0 check(on_hand between 0 and 1000000),reserved integer not null default 0 check(reserved>=0 and reserved<=on_hand),
 available integer generated always as(on_hand-reserved) stored,low_stock integer not null default 3 check(low_stock between 0 and 1000000),
 active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists space_shop_product_recent on public.space_shop_products(published,category,created_at desc,id);
create index if not exists space_shop_variant_product on public.space_shop_variants(product_id,active,id);
create table if not exists public.space_shop_orders(
 id uuid primary key default gen_random_uuid(),order_ref text not null unique default 'SP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
 buyer_id uuid not null references public.profiles(id),client_token uuid not null,request_fingerprint text not null,
 contact_name text not null,contact_phone text not null,buyer_note text not null default '',
 status text not null default 'pending' check(status in ('pending','confirmed','ready','collected','cancelled')),
 total_cents bigint not null check(total_cents>0),currency text not null default 'GHS' check(currency='GHS'),
 collection_note text not null,payment_status text not null default 'due' check(payment_status in ('due','paid')),
 payment_reference text,finance_entry_id uuid unique references public.finance_entries(id),
 collected_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(buyer_id,client_token)
);
create index if not exists space_shop_order_owner on public.space_shop_orders(buyer_id,created_at desc,id);
create index if not exists space_shop_order_queue on public.space_shop_orders(status,created_at desc,id);
create table if not exists public.space_shop_order_items(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.space_shop_orders(id),
 variant_id uuid not null references public.space_shop_variants(id),product_title text not null,variant_label text not null,sku text not null,unit text not null,
 quantity integer not null check(quantity between 1 and 99),unit_price_cents bigint not null check(unit_price_cents>0),
 line_total_cents bigint generated always as(quantity::bigint*unit_price_cents) stored,unique(order_id,variant_id)
);
create table if not exists public.space_shop_order_events(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.space_shop_orders(id),
 actor_id uuid references public.profiles(id),status text not null,note text not null,created_at timestamptz not null default now()
);
create index if not exists space_shop_order_event_recent on public.space_shop_order_events(order_id,created_at,id);
create table if not exists public.space_shop_stock_moves(
 id uuid primary key default gen_random_uuid(),variant_id uuid not null references public.space_shop_variants(id),order_id uuid references public.space_shop_orders(id),
 kind text not null check(kind in ('opening','recount','reserved','released','collected')),stock_delta integer not null,reserved_delta integer not null,
 on_hand_after integer not null,reserved_after integer not null,note text not null,actor_id uuid references public.profiles(id),created_at timestamptz not null default now()
);
create index if not exists space_shop_stock_recent on public.space_shop_stock_moves(variant_id,created_at desc,id);

alter table public.space_shop_settings enable row level security;
alter table public.space_shop_products enable row level security;
alter table public.space_shop_variants enable row level security;
alter table public.space_shop_orders enable row level security;
alter table public.space_shop_order_items enable row level security;
alter table public.space_shop_order_events enable row level security;
alter table public.space_shop_stock_moves enable row level security;
revoke all on public.space_shop_settings,public.space_shop_products,public.space_shop_variants,public.space_shop_orders,public.space_shop_order_items,public.space_shop_order_events,public.space_shop_stock_moves from public,anon,authenticated;
grant select on public.space_shop_settings,public.space_shop_products,public.space_shop_variants,public.space_shop_orders,public.space_shop_order_items,public.space_shop_order_events,public.space_shop_stock_moves to authenticated;
drop policy if exists shop_settings_read on public.space_shop_settings;
create policy shop_settings_read on public.space_shop_settings for select to authenticated using((select public.is_approved()));
drop policy if exists shop_products_read on public.space_shop_products;
create policy shop_products_read on public.space_shop_products for select to authenticated using((select public.is_approved()) and ((select public.is_admin()) or published and not archived));
drop policy if exists shop_variants_read on public.space_shop_variants;
create policy shop_variants_read on public.space_shop_variants for select to authenticated using((select public.is_approved()) and ((select public.is_admin()) or active and exists(select 1 from public.space_shop_products p where p.id=product_id and p.published and not p.archived)));
drop policy if exists shop_orders_read on public.space_shop_orders;
create policy shop_orders_read on public.space_shop_orders for select to authenticated using(buyer_id=(select auth.uid()) or (select public.is_admin()));
drop policy if exists shop_items_read on public.space_shop_order_items;
create policy shop_items_read on public.space_shop_order_items for select to authenticated using(exists(select 1 from public.space_shop_orders o where o.id=order_id and (o.buyer_id=(select auth.uid()) or (select public.is_admin()))));
drop policy if exists shop_events_read on public.space_shop_order_events;
create policy shop_events_read on public.space_shop_order_events for select to authenticated using(exists(select 1 from public.space_shop_orders o where o.id=order_id and (o.buyer_id=(select auth.uid()) or (select public.is_admin()))));
drop policy if exists shop_stock_read on public.space_shop_stock_moves;
create policy shop_stock_read on public.space_shop_stock_moves for select to authenticated using((select public.is_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('club-shop-images','club-shop-images',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists shop_image_read on storage.objects;
create policy shop_image_read on storage.objects for select to authenticated using(bucket_id='club-shop-images' and ((select public.is_admin()) or (select public.is_approved()) and exists(select 1 from public.space_shop_products p where p.image_path=name and p.published and not p.archived)));
drop policy if exists shop_image_add on storage.objects;
create policy shop_image_add on storage.objects for insert to authenticated with check(bucket_id='club-shop-images' and (select public.is_admin()) and split_part(name,'/',1)=auth.uid()::text);
drop policy if exists shop_image_cleanup on storage.objects;
create policy shop_image_cleanup on storage.objects for delete to authenticated using(bucket_id='club-shop-images' and (select public.is_admin()) and not exists(select 1 from public.space_shop_products p where p.image_path=name));

create or replace function public.space_shop_save_settings(p_open boolean,p_collection text,p_contact text,p_policy text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_open is null or p_collection is null or length(trim(p_collection)) not between 5 and 2000 or p_contact is null or length(trim(p_contact)) not between 5 and 1000 or p_policy is null or length(trim(p_policy)) not between 5 and 3000 then raise exception 'Complete collection, contact and policy details';end if;
 update public.space_shop_settings set is_open=p_open,collection_note=trim(p_collection),contact_note=trim(p_contact),policy_note=trim(p_policy),updated_at=now() where singleton;
end $$;
create or replace function public.space_shop_save_product(p_id uuid,p_title text,p_category text,p_description text,p_image text,p_published boolean,p_archived boolean default false) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid;v_old text;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_id is not null then select image_path into v_old from public.space_shop_products where id=p_id for update;if not found then raise exception 'Product unavailable';end if;end if;
 if p_title is null or length(trim(p_title)) not between 2 and 160 or p_description is null or length(trim(p_description)) not between 10 and 5000 or p_category is null or p_category not in ('Merchandise','Components','Kits','Tools & accessories','Other') or p_published is null or p_archived is null then raise exception 'Complete a valid title, category and description';end if;
 if p_image is not null and p_image is distinct from v_old and (split_part(p_image,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='club-shop-images' and name=p_image)) then raise exception 'Upload a product image first';end if;
 if p_id is null then insert into public.space_shop_products(title,category,description,image_path,published,archived,created_by) values(trim(p_title),p_category,trim(p_description),p_image,p_published,p_archived,auth.uid()) returning id into v_id;
 else update public.space_shop_products set title=trim(p_title),category=p_category,description=trim(p_description),image_path=p_image,published=p_published,archived=p_archived,updated_at=now() where id=p_id returning id into v_id;end if;
 return v_id;
end $$;
create or replace function public.space_shop_save_variant(p_id uuid,p_product uuid,p_sku text,p_label text,p_price bigint,p_stock integer,p_unit text,p_low integer,p_active boolean,p_note text) returns uuid language plpgsql security definer set search_path='' as $$ declare v_old public.space_shop_variants%rowtype;v_id uuid;v_reserved integer:=0;v_delta integer;begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 perform 1 from public.space_shop_products where id=p_product for update;if not found then raise exception 'Product unavailable';end if;
 if p_id is null and (select count(*) from public.space_shop_variants where product_id=p_product)>=50 then raise exception 'Maximum 50 options per product';end if;
 if p_id is not null then select * into v_old from public.space_shop_variants where id=p_id and product_id=p_product for update;if not found then raise exception 'Stock option unavailable';end if;v_reserved:=v_old.reserved;end if;
 if p_sku is null or upper(trim(p_sku))!~'^[A-Z0-9_-]{2,60}$' or p_label is null or length(trim(p_label)) not between 1 and 100 or p_price is null or p_price not between 1 and 100000000 or p_stock is null or p_stock not between 0 and 1000000 or p_stock<v_reserved or p_unit is null or length(trim(p_unit)) not between 1 and 30 or p_low is null or p_low not between 0 and 1000000 or p_active is null or p_note is null or length(trim(p_note)) not between 3 and 1000 then raise exception 'Check SKU, price, stock and reason. Stock cannot be below reserved orders.';end if;
 v_delta:=p_stock-coalesce(v_old.on_hand,0);
 if p_id is null then insert into public.space_shop_variants(product_id,sku,label,price_cents,on_hand,unit,low_stock,active) values(p_product,upper(trim(p_sku)),trim(p_label),p_price,p_stock,trim(p_unit),p_low,p_active) returning id into v_id;
 else update public.space_shop_variants set sku=upper(trim(p_sku)),label=trim(p_label),price_cents=p_price,on_hand=p_stock,unit=trim(p_unit),low_stock=p_low,active=p_active,updated_at=now() where id=p_id returning id into v_id;end if;
 insert into public.space_shop_stock_moves(variant_id,kind,stock_delta,reserved_delta,on_hand_after,reserved_after,note,actor_id) values(v_id,case when p_id is null then 'opening' else 'recount' end,v_delta,0,p_stock,v_reserved,trim(p_note),auth.uid());
 return v_id;
end $$;

create or replace function public.space_shop_catalog(p_search text default '',p_category text default 'all',p_sort text default 'newest',p_in_stock boolean default false,p_offset integer default 0,p_limit integer default 12,p_admin boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$ declare v_result jsonb;begin
 if not public.is_approved() then raise exception 'Approved member access required';end if;
 if p_admin is null or p_admin and not public.is_admin() then raise exception 'Administrator access required';end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 or p_sort is null or p_sort not in ('newest','price_low','price_high','name') or length(coalesce(p_search,''))>120 then raise exception 'Invalid shop filters';end if;
 with products as materialized(
  select p.*,coalesce((select min(v.price_cents) from public.space_shop_variants v where v.product_id=p.id and (p_admin or v.active)),0) min_price,
   coalesce((select sum(v.available) from public.space_shop_variants v where v.product_id=p.id and (p_admin or v.active)),0) available
  from public.space_shop_products p where (p_admin or p.published and not p.archived)
   and (p_category='all' or p.category=p_category)
   and (coalesce(trim(p_search),'')='' or strpos(lower(p.title||' '||p.description||' '||p.category),lower(trim(p_search)))>0
    or exists(select 1 from public.space_shop_variants v where v.product_id=p.id and strpos(lower(v.sku||' '||v.label),lower(trim(p_search)))>0))
 ),filtered as(select * from products where not coalesce(p_in_stock,false) or available>0),picked as(
  select * from filtered order by case when p_sort='price_low' then min_price end,case when p_sort='price_high' then min_price end desc,
   case when p_sort='name' then lower(title) end,created_at desc,id limit p_limit offset p_offset
 )select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.label,v.id) from public.space_shop_variants v where v.product_id=p.id and (p_admin or v.active)),'[]'::jsonb))) from picked p),'[]'::jsonb),'settings',(select to_jsonb(s) from public.space_shop_settings s where singleton)) into v_result;
 return v_result;
end $$;
create or replace function public.space_shop_product(p_product uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.label,v.id) from public.space_shop_variants v where v.product_id=p.id),'[]'::jsonb)) from public.space_shop_products p where p.id=p_product
$$;
create or replace function public.space_shop_cart(p_items jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$ declare v_result jsonb;begin
 if not public.is_approved() then raise exception 'Approved member access required';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>20 then raise exception 'Maximum 20 different items in a basket';end if;
 select coalesce(jsonb_agg(jsonb_build_object('variant_id',v.id,'product_id',p.id,'title',p.title,'label',v.label,'sku',v.sku,'unit',v.unit,'image_path',p.image_path,'price_cents',v.price_cents,'available',v.available,'quantity',(x->>'quantity')::integer)),'[]'::jsonb) into v_result
 from jsonb_array_elements(p_items) x join public.space_shop_variants v on v.id=(x->>'variant_id')::uuid join public.space_shop_products p on p.id=v.product_id
 where p.published and not p.archived and v.active;
 return v_result;
end $$;

create or replace function public.space_shop_place_order(p_items jsonb,p_name text,p_phone text,p_note text,p_token uuid,p_expected_total bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_old public.space_shop_orders%rowtype;v_fingerprint text;v_total bigint:=0;v_row record;v_qty integer;v_settings public.space_shop_settings%rowtype;v_ref text;
begin
 if not public.is_approved() then raise exception 'Approved member access required';end if;
 perform 1 from public.profiles where id=auth.uid() and membership_status='approved' and role in ('member','teacher','founder','admin') for share;
 if not found then raise exception 'Approved member access required';end if;
 if p_token is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 or p_name is null or length(trim(p_name)) not between 2 and 120 or p_phone is null or trim(p_phone)!~'^[+0-9 ()-]{7,30}$' or length(coalesce(p_note,''))>2000 then raise exception 'Check basket, collection name and phone number';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'quantity') is null or (x->>'quantity')!~'^[0-9]{1,2}$' or (x->>'quantity')::int not between 1 and 99 or (x->>'variant_id') is null or (x->>'variant_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Choose valid item quantities from 1 to 99';end if;
 if (select count(distinct x->>'variant_id') from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items) then raise exception 'Combine duplicate basket options';end if;
 v_fingerprint:=md5(p_items::text||trim(p_name)||'|'||trim(p_phone)||'|'||coalesce(trim(p_note),'')||'|'||coalesce(p_expected_total::text,''));
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext(p_token::text));
 select * into v_old from public.space_shop_orders where buyer_id=auth.uid() and client_token=p_token;
 if found then if v_old.request_fingerprint<>v_fingerprint then raise exception 'This checkout was already used. Check My orders before submitting a new order.';end if;return v_old.id;end if;
 select * into v_settings from public.space_shop_settings where singleton for share;
 if not v_settings.is_open then raise exception 'The shop is temporarily closed for new orders';end if;
 -- Products then variants are locked in a stable order to avoid cross-cart deadlocks.
 perform 1 from public.space_shop_products p where p.id in(select v.product_id from public.space_shop_variants v join jsonb_array_elements(p_items)x on v.id=(x->>'variant_id')::uuid) order by p.id for share;
 perform 1 from public.space_shop_variants v where v.id in(select (x->>'variant_id')::uuid from jsonb_array_elements(p_items)x) order by v.id for update;
 if (select count(*) from public.space_shop_variants v join jsonb_array_elements(p_items)x on v.id=(x->>'variant_id')::uuid)<>jsonb_array_length(p_items) then raise exception 'An item is no longer available';end if;
 for v_row in select v.*,p.title,p.published,p.archived,(x->>'quantity')::integer qty from public.space_shop_variants v join public.space_shop_products p on p.id=v.product_id join jsonb_array_elements(p_items)x on v.id=(x->>'variant_id')::uuid order by v.id loop
  if not v_row.active or not v_row.published or v_row.archived or v_row.available<v_row.qty then raise exception 'Not enough stock for %. Refresh your basket.',v_row.title||' / '||v_row.label;end if;
  v_total:=v_total+v_row.price_cents*v_row.qty;
 end loop;
 if p_expected_total is null or p_expected_total<>v_total then raise exception 'Prices have changed. Refresh and review your basket before ordering.';end if;
 insert into public.space_shop_orders(buyer_id,client_token,request_fingerprint,contact_name,contact_phone,buyer_note,total_cents,collection_note)
 values(auth.uid(),p_token,v_fingerprint,trim(p_name),trim(p_phone),coalesce(trim(p_note),''),v_total,v_settings.collection_note) returning id,order_ref into v_id,v_ref;
 for v_row in select v.*,p.title,(x->>'quantity')::integer qty from public.space_shop_variants v join public.space_shop_products p on p.id=v.product_id join jsonb_array_elements(p_items)x on v.id=(x->>'variant_id')::uuid order by v.id loop
  insert into public.space_shop_order_items(order_id,variant_id,product_title,variant_label,sku,unit,quantity,unit_price_cents) values(v_id,v_row.id,v_row.title,v_row.label,v_row.sku,v_row.unit,v_row.qty,v_row.price_cents);
  update public.space_shop_variants set reserved=reserved+v_row.qty,updated_at=now() where id=v_row.id;
  insert into public.space_shop_stock_moves(variant_id,order_id,kind,stock_delta,reserved_delta,on_hand_after,reserved_after,note,actor_id) values(v_row.id,v_id,'reserved',0,v_row.qty,v_row.on_hand,v_row.reserved+v_row.qty,'Reserved for '||v_ref,auth.uid());
 end loop;
 insert into public.space_shop_order_events(order_id,actor_id,status,note) values(v_id,auth.uid(),'pending','Order placed. Pay on collection.');
 insert into public.notifications(user_id,kind,title,target_type,target_id) values(auth.uid(),'shop_order','Order placed: '||v_ref,'shop_order',v_id);
 insert into public.notifications(user_id,kind,title,target_type,target_id) select id,'shop_order','New shop order: '||v_ref,'shop_order',v_id from public.profiles where role='admin' and membership_status='approved' and id<>auth.uid();
 return v_id;
end $$;

create or replace function public.space_shop_order_action(p_order uuid,p_status text,p_note text,p_payment_reference text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_order public.space_shop_orders%rowtype;v_row record;v_finance uuid;v_admin boolean:=public.is_admin();begin
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
   values('income','Club shop',v_order.total_cents::numeric/100,'Collection payment for '||v_order.order_ref,v_order.contact_name,trim(p_payment_reference),auth.uid()) returning id into v_finance;
 end if;
 update public.space_shop_orders set status=p_status,updated_at=now(),payment_status=case when p_status='collected' then 'paid' else payment_status end,
  payment_reference=case when p_status='collected' then trim(p_payment_reference) else payment_reference end,
  finance_entry_id=coalesce(v_finance,finance_entry_id),collected_at=case when p_status='collected' then now() else collected_at end where id=p_order;
 insert into public.space_shop_order_events(order_id,actor_id,status,note) values(p_order,auth.uid(),p_status,trim(p_note));
 insert into public.notifications(user_id,kind,title,target_type,target_id) values(v_order.buyer_id,'shop_order',v_order.order_ref||': '||initcap(p_status),'shop_order',p_order);
 insert into public.notifications(user_id,kind,title,target_type,target_id) select id,'shop_order',v_order.order_ref||': '||initcap(p_status),'shop_order',p_order from public.profiles where role='admin' and membership_status='approved' and id<>auth.uid() and id<>v_order.buyer_id;
end $$;
create or replace function public.space_shop_order_message(p_order uuid,p_note text) returns void language plpgsql security definer set search_path='' as $$ declare v_order public.space_shop_orders%rowtype;begin
 select * into v_order from public.space_shop_orders where id=p_order;
 if not found or auth.uid() is null or v_order.buyer_id<>auth.uid() and not public.is_admin() then raise exception 'Order unavailable';end if;
 if p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Add a message of 3 to 2000 characters';end if;
 insert into public.space_shop_order_events(order_id,actor_id,status,note) values(p_order,auth.uid(),'message',trim(p_note));
 insert into public.notifications(user_id,kind,title,target_type,target_id) select id,'shop_order','New message about '||v_order.order_ref,'shop_order',p_order from public.profiles where id<>auth.uid() and (id=v_order.buyer_id or role='admin' and membership_status='approved');
end $$;
create or replace function public.space_shop_orders(p_admin boolean default false,p_status text default 'all',p_search text default '',p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security invoker set search_path='' as $$ declare v_result jsonb;begin
 if auth.uid() is null or p_admin is null or p_admin and not public.is_admin() then raise exception 'Order access required';end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_search,''))>120 then raise exception 'Invalid page';end if;
 with matching as materialized(select o.* from public.space_shop_orders o where (p_admin or o.buyer_id=auth.uid()) and (p_status='all' or o.status=p_status) and (coalesce(trim(p_search),'')='' or strpos(lower(o.order_ref||' '||o.contact_name),lower(trim(p_search)))>0))
 select jsonb_build_object('total',(select count(*) from matching),'rows',coalesce((select jsonb_agg((to_jsonb(x)-case when p_admin then array[]::text[] else array['finance_entry_id'] end)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.space_shop_order_items i where i.order_id=x.id))) from(select * from matching order by created_at desc,id desc limit p_limit offset p_offset)x),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
create or replace function public.space_shop_order(p_order uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select (to_jsonb(o)-case when public.is_admin() then array[]::text[] else array['finance_entry_id'] end)||jsonb_build_object(
 'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.space_shop_order_items i where i.order_id=o.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.space_shop_order_events e where e.order_id=o.id),'[]'::jsonb))
 from public.space_shop_orders o where o.id=p_order
$$;

-- Order snapshots and stock/payment history cannot be rewritten or removed.
drop trigger if exists shop_items_immutable on public.space_shop_order_items;
create trigger shop_items_immutable before update or delete on public.space_shop_order_items for each row execute function public.reject_club_ledger_change();
drop trigger if exists shop_events_immutable on public.space_shop_order_events;
create trigger shop_events_immutable before update or delete on public.space_shop_order_events for each row execute function public.reject_club_ledger_change();
drop trigger if exists shop_stock_immutable on public.space_shop_stock_moves;
create trigger shop_stock_immutable before update or delete on public.space_shop_stock_moves for each row execute function public.reject_club_ledger_change();

revoke all on function public.space_shop_save_settings(boolean,text,text,text),public.space_shop_save_product(uuid,text,text,text,text,boolean,boolean),public.space_shop_save_variant(uuid,uuid,text,text,bigint,integer,text,integer,boolean,text),public.space_shop_catalog(text,text,text,boolean,integer,integer,boolean),public.space_shop_product(uuid),public.space_shop_cart(jsonb),public.space_shop_place_order(jsonb,text,text,text,uuid,bigint),public.space_shop_order_action(uuid,text,text,text),public.space_shop_order_message(uuid,text),public.space_shop_orders(boolean,text,text,integer,integer),public.space_shop_order(uuid) from public,anon;
grant execute on function public.space_shop_save_settings(boolean,text,text,text),public.space_shop_save_product(uuid,text,text,text,text,boolean,boolean),public.space_shop_save_variant(uuid,uuid,text,text,bigint,integer,text,integer,boolean,text),public.space_shop_catalog(text,text,text,boolean,integer,integer,boolean),public.space_shop_product(uuid),public.space_shop_cart(jsonb),public.space_shop_place_order(jsonb,text,text,text,uuid,bigint),public.space_shop_order_action(uuid,text,text,text),public.space_shop_order_message(uuid,text),public.space_shop_orders(boolean,text,text,integer,integer),public.space_shop_order(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
