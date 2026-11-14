# Proposed single read-only reviewer/demo lookup

Preparation only. No lookup, SSH/IP check, SQL, mailbox access, user/fixture change
or message is authorized or performed by this packet. Root will independently
review it before asking the owner one concrete access-and-lookup question.

The owner confirmed control of `support@barberplusplus.com` in direct iOS-chat
message `01a1d94b-0396-7e23-856b-fcaeac8fae25`, answering “Yes—I control that
inbox.” That is owner-reported inbox control, not an observed delivery, app-account
eligibility, permission to create/link/verify/reset an account, or permission to
share credentials. Apple private credential fields stay blank.

## Exact proposed lookup scope

- Auth and customer email matches only for case-insensitive
  `support@barberplusplus.com`. Internal canonical/linked identities are followed
  only through existing account links from that exact match, to detect scope and
  trusted work-role conflicts. Return counts/booleans, not records/identifiers.
- Exactly one case-sensitive shop named **Atlas Grooming — Sharq (Demo)**,
  barber **Kareem Shah** in that shop, and service **Beard trim** in that shop,
  with expected **15 minutes / KD3**. This is a lookup candidate from earlier QA,
  not permission to reuse it for App Review. Zero/multiple matches stop; no name
  variants, broad shop list, alias guessing or alternate fixtures are queried.
- The effective `private.customer_checkout_runtime.policy` scalar, restricted to
  `standard` or `email_only`; missing/ambiguous/unrecognized policy stops.

`lookup.sql` performs one REPEATABLE READ, READ ONLY transaction with 8-second
statement, 1-second lock and 12-second idle timeouts, ending in ROLLBACK. It first
checks PostgreSQL17 and exact required table/column types. psql `\if` skips the
data query if the schema is absent/unknown. No undeployed deletion tables/routines
are referenced. Unknown existing schema is not repaired or guessed. SQL invokes
only PostgreSQL built-ins; no account/deletion/booking/availability/business RPC,
login/provider action, schema change, function creation, dispatch or mail call.

## Data returned

Six counts: exact Auth email matches, exact customer email matches, linked
canonical customer count, exact shop/barber/service match counts. Booleans cover
email confirmation/password presence/known provider availability, enabled/trusted
customer role, work or account-link conflicts, pending team invitation to this
address, customer profile status, shop active/published, barber active/account
eligibility, assigned active service, exact price/duration, approved/recognized
regular schedule and room for15minutes, valid booking horizon and presence of
breaks/vacations. Only fixed field names, integer counts, booleans and the policy
enum can leave the process. No hashes, contacts, IDs, sessions, password hashes,
tokens, raw app metadata, schedules, booking rows or JSON documents are exported.

No `public.bookings` or session table is read. No occupancy, slot or date-specific
break/vacation availability is queried. Schedule checks validate regular JSON
shape/time intervals and break/vacation formats without returning them; they do
not reserve or prove any appointment slot. The regular-hours result is
configuration overlap only, not actual future-slot availability. `futureSlotVerified` and
`fullDeletionEligibilityVerified` must remain false. Full future deletion preview
also includes booking ownership and pending-job state not inspected here. A good
lookup is only CAPTURED_REVIEW_REQUIRED, never permission to provision or book.

This checks the checkout mode only; it does not verify live SMS provider state,
phone ownership, supported-number eligibility or actual delivery. Do not infer
that SMS is disabled, use fictional production numbers, seed verified flags or
relax proof. Native25 exposes email-code deletion proof, not a password-proof UI;
reviewer-controlled sign-up/inbox is still recommended for full native deletion.

## Fixed wrapper and later access boundary

`inspect_reviewer.py` embeds the exact SQL and its SHA256. It accepts no arguments
and requires root on `srv1073968`. It opens only the existing canonical root0700
parent/root0600 regular empty single-link backend lock, read-only with nonblocking
shared flock; never reads contents, creates, chmods or replaces it. It checks only
the fixed `supabase-db` image/running/healthy metadata before one fixed
`docker exec -i supabase-db psql -X -w -qAt -P pager=off ... -U postgres -d postgres`
invocation. No credentials/configuration files or other container environments
are read. stderr/exception text is suppressed; invalid/extra/duplicate output
fields, oversized output and unsafe types stop without leaking raw content.

Future approved execution uses the existing inspection SSH identity
`/Users/malabdullah/.ssh/codex_supabase_migration_ed25519`, strict existing
known_hosts, BatchMode, IdentitiesOnly, ConnectionAttempts1, no forwarding/PTY,
no control-master persistence. Stream the frozen wrapper once through stdin;
install no script/service/file on the VPS. Write a local-only exclusive invocation
marker before connecting; transport uncertainty or a stop does not permit retry.

Only after approval: one fresh api.ipify.org globally routable IPv4 lookup, exact
IP/32 TCP22 to **database VPS72.61.164.64/resource1073968 only**, existing original
firewall/rules verified before any change. A dedicated temporary copy may add
only that source. No frontend access. Any changed IP/host key/rules or unavailable
restore path stops. Record activation request epoch A; pass only typed public
decimal `BARBER_REVIEW_ACTIVATED_UTC=A`, `BARBER_REVIEW_STOP_UTC=A+2700`,
`BARBER_REVIEW_HARD_UTC=A+3600`. The wrapper refuses new work after45minutes and
caps commands to min30seconds/remaining stop window. Reserve15minutes to restore
access; hard limit60minutes, not a reset at script import or an automatic TTL.
Immediately restore the original profile/rules, remove only the temporary source
and verify closed SSH after success or failure; do not keep access for backup.

The output stops on schema uncertainty, duplicate/missing demo matches, identity
ambiguity/conflicts, unusable existing reviewer login, unknown policy/schedule or
ineligible demo. Even a clean unused address/eligible demo does not create or
repurpose anything. All three deletion switches stay OFF; no provider, customer,
mailbox, message, backup/archive, source/main/dev, native upload or submission work.

## Local validation and limitations

Synthetic/static checks verify fixed literals, schema-column allowlists against
cached main55f7bb6, query embedding/hash, transaction/metacommand/function allowlist,
output/no-leak/duplicate/size/type guards, stop classifications and deadlines.
No PostgreSQL parser/database/Docker/hosted test/provider execution is claimed.
Private field declarations and public columns are traced to local main source.
Auth field usage is traced to the existing source; its complete type definitions
are not in the public expected-schema file. All exact type expectations, including
Auth, are guarded at execution and stop if different; no actual production schema
or eligibility verification is claimed by these static checks.
The earlier frozen waiting/preparation packet is untouched.

## Concrete question draft for Root after independent review

May the Website agent run this reviewed read-only lookup once for
support@barberplusplus.com and exactly “Atlas Grooming — Sharq (Demo)” /
“Kareem Shah” / “Beard trim” (15 minutes / KD3), returning eligibility
counts/booleans and checkout mode only? It needs
one fresh public-IP check through ipify and an exact IP/32 database-only SSH window
for at most one hour, followed by immediate original-firewall restoration and
temporary-rule removal. No user/credential/fixture changes, bookings, messages,
verification bypass, backup read, deployment, activation, upload or submission.
