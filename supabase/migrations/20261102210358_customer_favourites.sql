begin;
-- References only: contact details remain in the canonical customer record.
create table private.customer_favourites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  barber_id uuid references public.barbers(id) on delete cascade,
  saved_barber_branch_id uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_favourite_target check ((branch_id is not null)::int + (barber_id is not null)::int = 1),
  constraint customer_favourite_shop_context check (barber_id is not null or saved_barber_branch_id is null)
);
create unique index customer_favourite_shop_unique on private.customer_favourites(customer_id,branch_id) where branch_id is not null;
create unique index customer_favourite_barber_unique on private.customer_favourites(customer_id,barber_id) where barber_id is not null;
create index customer_favourite_branch_fk on private.customer_favourites(branch_id) where branch_id is not null;
create index customer_favourite_barber_fk on private.customer_favourites(barber_id) where barber_id is not null;
create index customer_favourite_context_fk on private.customer_favourites(saved_barber_branch_id) where saved_barber_branch_id is not null;
alter table private.customer_favourites enable row level security;
revoke all on private.customer_favourites from public,anon,authenticated,service_role;

-- The gateway verifies the bearer token; the database independently resolves
-- the live session, trusted role and canonical account using the existing API.
create function private.customer_favourites_api(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  profile jsonb;
  owner_id uuid;
  target uuid;
  shop_id uuid;
  kind text;
begin
  profile:=private.customer_account_api('profile',p_data);
  owner_id:=nullif(profile->>'customerId','')::uuid;
  if owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('favourites-list','favourites-save','favourites-remove') then raise exception 'INVALID_REQUEST'; end if;
  if p_action<>'favourites-list' then
    kind:=p_data->>'kind';target:=nullif(p_data->>'target_id','')::uuid;
    if kind is null or kind not in ('shop','barber') or target is null then raise exception 'INVALID_REQUEST'; end if;
    if p_action='favourites-remove' then
      delete from private.customer_favourites where customer_id=owner_id and
        ((kind='shop' and branch_id=target) or (kind='barber' and barber_id=target));
    else
      if kind='shop' then
        select id into shop_id from public.branches where id=target and status='active';
      else
        select b.branch_id into shop_id from public.barbers b join public.branches br on br.id=b.branch_id
          where b.id=target and b.status='active' and br.status='active'
          and exists(select 1 from public.services s where s.id=any(b.service_ids) and s.branch_id=b.branch_id and s.status='active');
      end if;
      if shop_id is null then raise exception 'FAVOURITE_UNAVAILABLE'; end if;
      if (select count(*) from private.customer_favourites where customer_id=owner_id)>=500 and not exists(
        select 1 from private.customer_favourites where customer_id=owner_id and ((kind='shop' and branch_id=target) or (kind='barber' and barber_id=target))) then raise exception 'FAVOURITES_LIMIT';end if;
      insert into private.customer_favourites(customer_id,branch_id,barber_id,saved_barber_branch_id)
        values(owner_id,case when kind='shop' then target end,case when kind='barber' then target end,case when kind='barber' then shop_id end)
        on conflict do nothing;
    end if;
  end if;
  return (select coalesce(jsonb_agg(item order by created_at desc,id),'[]'::jsonb) from (
    select f.id,f.created_at,jsonb_build_object(
      'kind',case when f.barber_id is null then 'shop' else 'barber' end,
      'targetId',coalesce(f.barber_id,f.branch_id),
      'name',case when f.barber_id is null then br.name else b.name end,
      'nameAr',case when f.barber_id is null then br.name_ar else b.name_ar end,
      'imageUrl',case when f.barber_id is null then br.image_url else b.avatar_url end,
      'shopId',br.id,'shopName',br.name,'shopNameAr',br.name_ar,
      'city',coalesce(nullif(trim(br.city),''),a.name_en,''),
      'cityAr',case when nullif(trim(br.city),'') is null or trim(br.city)=a.name_en then a.name_ar else '' end,
      'available',coalesce(br.status='active' and (f.barber_id is null or (b.status='active' and exists(
        select 1 from public.services s where s.id=any(b.service_ids) and s.branch_id=b.branch_id and s.status='active'))),false),
      'locationChanged',f.barber_id is not null and f.saved_barber_branch_id is distinct from b.branch_id
    ) item from private.customer_favourites f
    left join public.barbers b on b.id=f.barber_id
    left join public.branches br on br.id=coalesce(b.branch_id,f.branch_id)
    left join public.areas a on a.id=br.area_id where f.customer_id=owner_id
  ) rows);
end;
$$;
revoke all on function private.customer_favourites_api(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.customer_favourites_api(text,jsonb) to service_role;
create function public.customer_favourites_api(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.customer_favourites_api(p_action,p_data); $$;
revoke all on function public.customer_favourites_api(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.customer_favourites_api(text,jsonb) to service_role;
commit;
