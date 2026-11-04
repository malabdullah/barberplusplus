-- One marker per canonical customer, cleared on every actual contact change.
create table private.customer_phone_verifications (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table private.customer_phone_verifications enable row level security;
revoke all on private.customer_phone_verifications from public, anon, authenticated;

create function private.clear_customer_phone_verification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.customer_phone_verifications where customer_id = new.id;
  return null;
end;
$$;
revoke all on function private.clear_customer_phone_verification() from public, anon, authenticated;

create trigger clear_customer_phone_verification
after update on public.customers
for each row when (old.phone is distinct from new.phone or old.country_code is distinct from new.country_code)
execute function private.clear_customer_phone_verification();

create function public.customer_checkout_phone(p_customer uuid, p_country text, p_phone text, p_verified boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  contact public.customers%rowtype;
begin
  select * into contact from public.customers where id = p_customer for update;
  if not found then return false; end if;
  if not p_verified then
    return contact.phone is not distinct from p_phone and contact.country_code is not distinct from p_country
      and exists (select 1 from private.customer_phone_verifications where customer_id = p_customer);
  end if;
  if nullif(contact.phone, '') is null then
    update public.customers set phone = p_phone, country_code = p_country, updated_at = now()
      where id = p_customer;
  elsif contact.phone is distinct from p_phone or contact.country_code is distinct from p_country then
    return false;
  end if;
  insert into private.customer_phone_verifications(customer_id) values (p_customer)
    on conflict (customer_id) do update set verified_at = excluded.verified_at;
  return true;
end;
$$;
revoke all on function public.customer_checkout_phone(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.customer_checkout_phone(uuid,text,text,boolean) to service_role;
