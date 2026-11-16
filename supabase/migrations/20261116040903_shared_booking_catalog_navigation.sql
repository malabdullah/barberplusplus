begin;
do $migration$
declare definition text;updated text;
begin
 definition:=pg_get_functiondef('private.customer_booking_discovery(text,jsonb)'::regprocedure);
 updated:=replace(definition,$old$  if p_action='filters' then$old$,$new$  if p_action='entry' then
    if p_data->>'kind' not in ('shop','barber') or p_data->>'kind' is null then raise exception 'INVALID_REQUEST';end if;
    if p_data->>'kind'='barber' then
      select * into selected from public.barbers where id=target and status='active' and (account is null or user_id is distinct from account);
      select * into shop from public.branches where id=selected.branch_id and status='active' and publication_state='published';
      if selected.id is null or shop.id is null or not private.booking_provider_ready(selected,shop) then raise exception 'INVALID_SELECTION';end if;
    else
      select * into shop from public.branches where id=shop_id and status='active' and publication_state='published';
      if shop.id is null or not exists(select 1 from public.barbers b where b.branch_id=shop.id and b.status='active'
        and(account is null or b.user_id is distinct from account)and private.booking_provider_ready(b,shop))then raise exception 'INVALID_SELECTION';end if;
    end if;
    if nullif(trim(coalesce(shop.city,(select name_en from public.areas where id=shop.area_id))), '') is null then raise exception 'INVALID_SELECTION';end if;
    return jsonb_build_object('kind',p_data->>'kind','branchId',shop.id,'barberId',case when p_data->>'kind'='barber'then selected.id end,
      'city',coalesce(nullif(trim(shop.city),''),(select name_en from public.areas where id=shop.area_id)));
  end if;
  if p_action='filters' then$new$);
 if updated=definition then raise exception 'Discovery entry patch contract changed';end if;
 execute updated;
 definition:=pg_get_functiondef('private.booking_share_live(uuid)'::regprocedure);
 updated:=replace(definition,$old$'shop',s.name$old$,$new$'shopId',s.id,'barberId',bar.id,'shop',s.name$new$);
 if updated=definition then raise exception 'Shared public catalog identity contract changed';end if;
 execute updated;
end$migration$;
commit;
