-- Customer-facing history must be keyed by authenticated account, not phone.
-- This additive table does not backfill legacy records or change booking writes.
create table private.customer_booking_owners (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  account_user_id uuid not null references private.customer_accounts(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index customer_booking_owners_account_idx on private.customer_booking_owners(account_user_id);
alter table private.customer_booking_owners enable row level security;
revoke all on private.customer_booking_owners from public, anon, authenticated, service_role;
alter table private.customer_booking_owners owner to postgres;
