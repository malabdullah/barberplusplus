set local lock_timeout = '5s';

-- Auth stores a missing password as either an empty string or NULL. OAuth
-- confirmation can switch between those representations without changing a credential.
drop trigger enforce_customer_password_proof on auth.users;

create constraint trigger enforce_customer_password_proof
after update on auth.users
deferrable initially deferred for each row
when (nullif(old.encrypted_password, '') is distinct from nullif(new.encrypted_password, ''))
execute function private.enforce_customer_password_proof();
