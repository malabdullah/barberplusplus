-- Store contact fields consistently as well as comparing normalized claims.
-- This preserves the existing customer ON CONFLICT lookup and prevents a
-- mismatching private phone_e164 field from becoming a second phone source.
create function private.normalize_contact_phone()
returns trigger language plpgsql security definer set search_path='' as $$
declare number text; country text; changes jsonb;
begin
  number:=private.canonical_phone(new.phone,new.country_code);
  if number is null then
    changes:=jsonb_build_object('phone',null);
    if tg_table_name='customer_accounts' then changes:=changes||jsonb_build_object('country_code',null,'phone_e164',null); end if;
  else
    country:=regexp_replace(coalesce(nullif(new.country_code,''),'+965'),'[^0-9]','','g');
    if country='' or left(number,length(country)+1)<>'+'||country then raise exception using errcode='22023',message='INVALID_PHONE'; end if;
    changes:=jsonb_build_object('country_code','+'||country,'phone',substr(number,length(country)+2));
    if tg_table_name='customer_accounts' then changes:=changes||jsonb_build_object('phone_e164',number); end if;
  end if;
  new:=jsonb_populate_record(new,changes);
  return new;
end;
$$;
revoke all on function private.normalize_contact_phone() from public,anon,authenticated,service_role;

create trigger normalize_contact_phone before insert or update of phone,country_code on public.barbers for each row execute function private.normalize_contact_phone();
create trigger normalize_contact_phone before insert or update of phone,country_code on public.branches for each row execute function private.normalize_contact_phone();
create trigger normalize_contact_phone before insert or update of phone,country_code on public.customers for each row execute function private.normalize_contact_phone();
create trigger normalize_contact_phone before insert or update of phone,country_code,phone_e164 on private.customer_accounts for each row execute function private.normalize_contact_phone();

update public.barbers set phone=phone where phone is not null and private.canonical_phone(phone,country_code) is distinct from country_code||phone;
update public.branches set phone=phone where phone is not null and private.canonical_phone(phone,country_code) is distinct from country_code||phone;
update public.customers set phone=phone where private.canonical_phone(phone,country_code) is distinct from country_code||phone;
update private.customer_accounts set phone=phone where private.canonical_phone(phone,country_code) is distinct from country_code||phone
  or private.canonical_phone(phone,country_code) is distinct from phone_e164;
