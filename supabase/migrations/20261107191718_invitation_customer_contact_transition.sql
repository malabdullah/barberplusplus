begin;
do $migration$
declare source text;
begin
 select pg_get_functiondef('public.shop_barber_invitation_api(text,jsonb)'::regprocedure) into source;
 source:=replace(source,'select * into person from auth.users where lower(email)=inv.email and deleted_at is null for update;','select * into person from auth.users where lower(email)=inv.email and deleted_at is null;');
 source:=replace(source,' uid:=nullif(p_data->>''new_user'','''')::uuid;','
 -- Match the canonical contact write lock order: customer first, then Auth.
 if person.id is not null then
  select c.* into profile from public.customers c join private.customer_accounts a on a.customer_id=c.id where a.user_id=person.id for update of c;
  select * into person from auth.users where id=person.id and deleted_at is null for update;
  if person.id is null or lower(person.email)<>inv.email or person.raw_app_meta_data->>''role'' is distinct from ''customer'' or (person.banned_until is not null and person.banned_until>now()) then raise exception ''ACCOUNT_CHANGED'';end if;
 end if;
 uid:=nullif(p_data->>''new_user'','''')::uuid;');
 source:=replace(source,' dial:=''+''||substring(full_phone from 2 for 3);','
 dial:=''+''||substring(full_phone from 2 for 3);
 perform pg_advisory_xact_lock(hashtextextended(''barber-phone:''||full_phone,0));
 -- Reclassify only the same canonical person. No number matching can attach
 -- another customer record, and uniqueness guards remain enabled throughout.
 update private.phone_numbers set owner_key=''user:''||person.id::text,customer_user_id=person.id
 where phone=full_phone and owner_key=''customer''
 and (customer_user_id=person.id or customer_record_id=profile.id);');
 execute source;
end $migration$;
commit;
