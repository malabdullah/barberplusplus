-- Reject invalid country codes instead of interpreting a local number as international.
-- Arabic country-code digits use the same canonical claim as ASCII digits.
create or replace function private.canonical_phone(p_phone text, p_country_code text default '+965', p_international boolean default false)
returns text language plpgsql immutable set search_path='' as $$
declare
  value text := trim(translate(coalesce(p_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'));
  digits text;
  country text := regexp_replace(translate(coalesce(nullif(p_country_code,''),'+965'),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
begin
  value := replace(replace(value,chr(8206),''),chr(8207),'');
  if value='' then return null; end if;
  if country !~ '^[1-9][0-9]{0,2}$' then raise exception using errcode='22023',message='INVALID_PHONE'; end if;
  if value !~ '^[+0-9[:space:]().-]+$' or value ~ '.+[+]' then
    raise exception using errcode='22023',message='INVALID_PHONE';
  end if;
  digits := regexp_replace(value,'[^0-9]','','g');
  if left(value,1)='+' or p_international then null;
  elsif left(digits,2)='00' then digits:=substr(digits,3);
  elsif not (left(digits,length(country))=country and length(digits)>10) then digits:=country||digits;
  end if;
  -- A domestic trunk prefix is not part of the international number.
  if left(digits,4) in ('9660','9710') then digits:=left(digits,3)||substr(digits,5); end if;
  if digits !~ '^[1-9][0-9]{6,14}$' then raise exception using errcode='22023',message='INVALID_PHONE'; end if;
  return '+'||digits;
end;
$$;
revoke all on function private.canonical_phone(text,text,boolean) from public,anon,authenticated,service_role;


create or replace function private.normalize_contact_phone()
returns trigger language plpgsql security definer set search_path='' as $$
declare number text; country text; changes jsonb;
begin
  number:=private.canonical_phone(new.phone,new.country_code);
  if number is null then
    changes:=jsonb_build_object('phone',null);
    if tg_table_name='customer_accounts' then changes:=changes||jsonb_build_object('country_code',null,'phone_e164',null); end if;
  else
    country:=regexp_replace(translate(coalesce(nullif(new.country_code,''),'+965'),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
    if country='' or left(number,length(country)+1)<>'+'||country then raise exception using errcode='22023',message='INVALID_PHONE'; end if;
    changes:=jsonb_build_object('country_code','+'||country,'phone',substr(number,length(country)+2));
    if tg_table_name='customer_accounts' then changes:=changes||jsonb_build_object('phone_e164',number); end if;
  end if;
  new:=jsonb_populate_record(new,changes);
  return new;
end;
$$;
revoke all on function private.normalize_contact_phone() from public,anon,authenticated,service_role;

