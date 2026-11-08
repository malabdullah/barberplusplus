# Native checkout recovery compatibility on hosted Test

This restores the existing native lost-response and price-consent contracts on
Supabase barber-test only. It is separate from the per-barber auto-confirmation
feature and does not change Auth, SQL, secrets, the Test gateway or production.

The previous active customer-booking v22 contained the new discovery routes but
omitted recover-booking and resolve-booking. Native clients with a committed
booking and a lost HTTP response consequently could not recover its receipt.
The additive reconciliation keeps the current discovery, phone verification,
policy, ownership and shared-account protections.

Recovery accepts only the original signed verified proof. It never accepts a
client-selected booking/account ID and never authorizes a new booking write.
Account reads/resolution require a live session for the original account.
Expired proofs can read or resolve for a bounded 24-hour recovery window; guest
claim capabilities retain the original booking's one-hour deadline. Resolution
uses the installed service-only helper and the existing booking advisory lock.

Receipts read purchased service names from service_snapshot, not the current
service catalog. Legacy empty snapshots use a bounded ID lookup in purchased
order; malformed snapshots fail closed.

The native RPC routing and recovery dependencies are enabled only in cloud-test.
Non-Test booking continues using public.customer_booking and its original guest
receipt behavior. Production and password-recovery-v2 acceptance remain separate;
this document is not authorization to enable native recovery in production.

Pure verification includes all 144 Function tests, the booking entrypoint type
check and lint. Complete hosted native acceptance must additionally test lost
committed responses, journal restoration, exact receipt ownership and no duplicate
booking. Do not call the native journey accepted until that run passes.
