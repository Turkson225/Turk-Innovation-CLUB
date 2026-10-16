-- Run after upgrade_club_shop.sql. Run this whole file in one SQL Editor query.
-- Future first publications notify approved club members. Existing stock is not rebroadcast.
begin;
do $$ begin
 if to_regclass('public.space_shop_products') is null or to_regclass('public.space_shop_variants') is null then
  raise exception 'Run upgrade_club_shop.sql first';
 end if;
end $$;
create table if not exists public.space_shop_product_announcements(
 product_id uuid primary key references public.space_shop_products(id),
 announced_at timestamptz not null default now()
);
alter table public.space_shop_product_announcements enable row level security;
revoke all on public.space_shop_product_announcements from public,anon,authenticated;
grant select on public.space_shop_product_announcements to authenticated;
drop policy if exists shop_announcement_admin on public.space_shop_product_announcements;
create policy shop_announcement_admin on public.space_shop_product_announcements for select to authenticated
 using((select public.is_admin()));

-- Mark the existing, orderable catalog without sending historical alerts on installation/rerun.
insert into public.space_shop_product_announcements(product_id)
 select p.id from public.space_shop_products p where p.published and not p.archived
  and exists(select 1 from public.space_shop_variants v where v.product_id=p.id and v.active and v.available>0)
 on conflict(product_id) do nothing;

create or replace function public.space_shop_announce_product(p_product uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_title text;v_claim uuid;
begin
 if not public.is_admin() then return;end if;
 select p.title into v_title from public.space_shop_products p where p.id=p_product and p.published and not p.archived
  and exists(select 1 from public.space_shop_variants v where v.product_id=p.id and v.active and v.available>0);
 if not found then return;end if;
 -- No extra product lock: callers already lock product before variant. A unique claim prevents duplicate fan-out.
 insert into public.space_shop_product_announcements(product_id) values(p_product)
  on conflict(product_id) do nothing returning product_id into v_claim;
 if v_claim is null then return;end if;
 insert into public.notifications(user_id,kind,title,target_type,target_id)
  select p.id,'shop_product','New in SPACE shop: '||v_title,'shop_product',p_product
   from public.profiles p where p.membership_status='approved' and p.role in ('member','teacher','founder','admin')
    and p.id is distinct from auth.uid();
end $$;
revoke all on function public.space_shop_announce_product(uuid) from public,anon,authenticated;

create or replace function public.space_shop_product_announcement_trigger() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform public.space_shop_announce_product(new.id);return new;
end $$;
create or replace function public.space_shop_variant_announcement_trigger() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if tg_op='UPDATE' and new.active is not distinct from old.active
  and new.on_hand is not distinct from old.on_hand and new.price_cents is not distinct from old.price_cents then return new;end if;
 perform public.space_shop_announce_product(new.product_id);return new;
end $$;
revoke all on function public.space_shop_product_announcement_trigger(),public.space_shop_variant_announcement_trigger() from public,anon,authenticated;
drop trigger if exists shop_product_announcement on public.space_shop_products;
create trigger shop_product_announcement after insert or update of published,archived on public.space_shop_products
 for each row execute function public.space_shop_product_announcement_trigger();
drop trigger if exists shop_variant_announcement on public.space_shop_variants;
create trigger shop_variant_announcement after insert or update of active,on_hand,price_cents on public.space_shop_variants
 for each row execute function public.space_shop_variant_announcement_trigger();
notify pgrst,'reload schema';
commit;
