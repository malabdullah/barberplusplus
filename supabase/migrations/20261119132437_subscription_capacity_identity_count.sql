begin;
-- Count net new people, including an identity change from a shared legacy
-- profile. Lock both businesses before comparing the old/new contributions.
create or replace function private.billing_guard_capacity()returns trigger
language plpgsql security definer set search_path='' as $$
declare old_business uuid;new_business uuid;was_counted boolean:=false;is_counted boolean:=false;
 old_person boolean:=false;new_person boolean:=false;a jsonb;quote jsonb;total integer;
begin
 if not private.billing_enforced()then return null;end if;
 if tg_op<>'INSERT'then
  select business_id into old_business from private.billing_shops where branch_id=old.branch_id;
  was_counted:=private.billing_barber_counted(old);
 end if;
 if tg_op<>'DELETE'then
  select business_id into new_business from private.billing_shops where branch_id=new.branch_id;
  is_counted:=private.billing_barber_counted(new);
 end if;
 if not was_counted and not is_counted then return null;end if;
 if tg_op='UPDATE'and was_counted=is_counted and old_business is not distinct from new_business
  and coalesce(old.user_id,old.id)is not distinct from coalesce(new.user_id,new.id)then return null;end if;
 perform private.billing_lock_businesses(array[old_business,new_business]);
 if is_counted then
  if new_business is null then raise exception 'BILLING_ACCESS_REQUIRED';end if;
  new_person:=not exists(select 1 from public.barbers b join private.billing_shops l on l.branch_id=b.branch_id
    where l.business_id=new_business and b.id<>new.id and private.billing_barber_counted(b)
     and coalesce(b.user_id,b.id)=coalesce(new.user_id,new.id));
  if was_counted and old_business is not distinct from new_business then
   old_person:=not exists(select 1 from public.barbers b join private.billing_shops l on l.branch_id=b.branch_id
    where l.business_id=old_business and b.id<>new.id and private.billing_barber_counted(b)
     and coalesce(b.user_id,b.id)=coalesce(old.user_id,old.id));
  end if;
  if new_person and not old_person then
   total:=private.billing_active_count(new_business);
   quote:=private.billing_capacity_quote(new_business,total);a:=private.billing_access(new_business);
   if not(quote->>'allowed')::boolean and not(a->>'status'not in('active','grace')and(a->'manualBranchIds')?new.branch_id::text)then
    raise exception '%',quote->>'reason'using detail=quote::text;
   end if;
   if a->>'status'='active'and(quote->>'allowed')::boolean then
    update private.billing_subscriptions set paid_capacity=greatest(paid_capacity,total)where business_id=new_business;
   end if;
  end if;
 end if;
 return null;
end$$;
commit;
