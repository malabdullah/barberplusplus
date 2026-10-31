# Customer booking and account production preparation

Status: prepared and verified on hosted Test; production activation pending the
production OAuth credentials, sending-domain setup, PR checks and controlled SQL
adoption. The owner's production deployment instruction includes preserving all
existing accounts, customers, bookings and storage objects.

The release exposes the approved one-page booking journey and customer accounts
in production. Customer email/password confirmation and recovery use Auth-issued
links through configured SMTP. Hosted Test exercises the same mail adapter using
its private Send Email hook. The local mail catcher remains restricted to local
Test. Production requires explicit customer activation and HTTPS app/API origins;
legacy phone-code simulation endpoints remain unavailable there.

## Data-preserving migration review

The current production schema has nine accepted migrations. Six customer
migrations add private profiles, session/reset guards, social identity handling
and private booking ownership. Two forward migrations replace the overlap
exclusion constraint with a serialized per-barber write guard and retain a GiST
range lookup index. The guard runs after row authorization and validation, so a
rejected write cannot inspect another shop's scheduling data. Conflicts roll
back the statement, including trigger effects. Historical schedules and ordinary
status/metadata edits remain intact; new schedules and reactivations are checked.

Production contains one legacy overlapping booking pair. Replaying the
intermediate `bookings_no_overlapping_appointments` exclusion creation from
`20261030170311_customer_booking_test.sql` would reject those existing rows.
Controlled adoption therefore applies the combined final effects of the pending
migrations in one transaction, omitting only that explicitly superseded
intermediate constraint creation. The later forward migration removes that
constraint in a clean replay. This omission must be recorded in the adoption
receipt; do not claim the original intermediate statement ran. Preserve all
original migration files/hashes and leave the automatic helper's SQL restrictions
unchanged. Adopt only after comparing the final schema fingerprint with the
canonical migration replay and matching the signed release source/archive.

Guard adoption with an advisory release lock, bounded lock/statement timeouts,
expected ordered ledger hashes and a fresh schema fingerprint. Compare existing
booking/customer/Auth contents inside the locked transaction. Write the exact
migration ledger and final schema fingerprint as part of the controlled adoption.
Never replay baseline creation or copy production rows to Test. Database rollback
is not part of frontend/Functions rollback.

## Validation recorded on 2026-10-31

- Maintained lint, Functions/unit/operational checks and production build passed.
- Hosted Test backend checks passed for five staff roles, cross-shop denial,
  anonymous gateway denial, private inbox denial, owned storage permissions and
  captured Auth recovery mail.
- All seven hosted browser checks passed: four staff workspaces with mobile
  Arabic/light layouts, guest booking, customer confirmation through an Auth
  link, and private inbox/mobile landing.
- A schema-only export of the current production database was restored into the
  pinned `supabase/postgres:17.6.1.136` digest, network disabled and no published
  ports. Synthetic fixtures included an overlapping historical pair. Combined
  adoption preserved booking contents; all 221 database authorization assertions
  passed. Concurrent overlapping read-committed writers were rejected; stale
  repeatable-read writers failed serialization. The final public behavioral
  schema matches `supabase/schema.expected.sql`.
- Production has genuine encrypted B2 backup/restore evidence captured on
  2026-10-31. Recheck freshness at activation; do not reuse an old commit-bound
  backup exception.

Private rehearsal inputs, exact SQL/hash receipts and logs are retained outside
Git in the operator's `.release-private/customer-production-20261031/` directory.
They contain schema metadata only, with no production rows or role password
hashes. Hosted Test remains `qvkucvcjmojjbphlzlks`; its private mailbox, gateway
secrets and operational migrations must never be deployed to production.

## Activation checks still required

Configure separate production Google/Apple clients and the actual HTTPS callback,
SMTP sender authentication and Apple's private relay sender registration. Keep
staff settings and callbacks intact. Store secrets only in private production
configuration. Preserve protected PR/CI and signed artifact delivery, coordinate
the controller pause for reviewed SQL adoption, then verify the actual running
commit/digest and read-only Auth/REST/Storage/Realtime/Functions health. Remove
only the temporary operator SSH firewall rules after release checks.
