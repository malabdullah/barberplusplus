begin;
set local lock_timeout = '5s';

-- An unauthenticated registration may request email delivery. The mailbox
-- owner establishes a password separately after confirming the address.
create function private.discard_unverified_customer_password() returns trigger
language plpgsql set search_path='' as $$
begin
  new.encrypted_password := null;
  return new;
end;
$$;
revoke all on function private.discard_unverified_customer_password() from public,anon,authenticated,service_role;

create trigger discard_unverified_customer_password before update on auth.users
for each row when (
  old.raw_app_meta_data->>'role'='customer' and new.raw_app_meta_data->>'role'='customer'
  and old.email is not null and old.email is not distinct from new.email
  and old.email_confirmed_at is null and new.email_confirmed_at is not null
  and old.phone_confirmed_at is null and old.invited_at is null
)
execute function private.discard_unverified_customer_password();

-- Exempt only the removal enforced by the trigger above. All credential
-- writes for verified accounts still need a prepared, single-use proof.
drop trigger enforce_customer_password_proof on auth.users;
create constraint trigger enforce_customer_password_proof after update on auth.users
deferrable initially deferred for each row when (
  nullif(old.encrypted_password, '') is distinct from nullif(new.encrypted_password, '')
  and not coalesce((
    new.encrypted_password is null
    and old.raw_app_meta_data->>'role'='customer' and new.raw_app_meta_data->>'role'='customer'
    and old.email is not null and old.email is not distinct from new.email
    and old.email_confirmed_at is null and new.email_confirmed_at is not null
    and old.phone_confirmed_at is null and old.invited_at is null
  ),false)
)
execute function private.enforce_customer_password_proof();
commit;
