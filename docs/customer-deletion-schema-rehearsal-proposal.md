> **Superseded on 13 November 2026; no extraction performed.** The approved
> rehearsal rebuilt the platform from exact official images plus committed main
> migrations. All selected production metadata matched and all 47 database suites
> and real Auth/Storage scenarios passed. No broader production export or reopened
> access was needed. The historical proposal below grants no authority to extract.
> See [completed evidence](../artifacts/customer-account-deletion-2026-11-13/platform-rehearsal-report.md).

# Proposal: schema-faithful deletion rehearsal baseline

**Proposal only. Do not export, reopen SSH, deploy, or activate deletion from this
file.** The approved metadata inspection is complete; broader extraction needs
separate owner approval. Production images are verified and the selected 15
routine hashes match main. Columns and hashes alone cannot reproduce the whole
platform faithfully enough to claim PostgreSQL/Auth/Storage behavioral parity.

## Minimal source and scope

Use the database VPS only, a newly approved operator IP/32 and bounded window,
existing migration SSH key and strict host validation. Never access the frontend
VPS or modify SSH credentials/policy. Collect through memory/stdout; no server
export files, production configuration changes, helper installation or writes.

Select only catalogue definitions needed by the current main baseline and the
six deletion migrations:

- `public`: branches, barbers, services, customers, customer_staff_details,
  bookings, booking_reminders, notifications, logs, audit_logs,
  suspicious_activities, whatsapp_conversations, whatsapp_messages, whatsapp_logs.
- `private`: customer_* and account_* relations referenced by deletion, phone_numbers,
  phone_sources, shop_barber_invitations, admin_password_reset_guards and
  announcement_* relations. Export only table/sequence/constraint/index/ACL/RLS/
  trigger signatures required by those dependencies; no unrelated private feature.
- `auth`: users, identities, sessions, refresh_tokens and the referenced dependent
  platform relations/types. `storage`: objects/buckets and their referenced platform
  dependencies. Pin exact dependency closure before extraction; if closure adds an
  unrelated schema/object, stop and show that addition for review.
- Extension names/versions, relation types, nullability, generated/default expressions,
  primary/unique/foreign/check constraints, indexes, policy and trigger definitions,
  roles/privileges, publication membership and migration **names/hashes only**.
  Never export cron commands, configuration values or Vault objects/data.

## Routine bodies and secret-bearing definitions

Prefer **zero production routine-body transfer**. Match body hashes/signatures to
committed main source and compose the exact existing string patches locally, as
already done for all 15 inspected routines. Use official pinned platform source
for Auth/Storage helpers, requiring its body hash to match the live signature.
Unmatched routines remain an explicit blocker: do not export their bodies under
this proposal or replace them with invented stubs.

Inspect default/policy/index/constraint expressions on the server before any
transfer using a parsed SQL allowlist. Allow known schema constants and verified
source expressions only. Reject unknown literals, connection strings, passwords,
JWT/API/private-key material or secret-bearing defaults. Report only rejected
object names and hashes, never rejected text. Use a local fresh synthetic value
only for a clearly identified configuration default and document that difference;
never claim exact parity when a behavior-changing expression remains unresolved.
Do not rely on token regexes as the sole secret filter.

No `pg_dumpall` password/role hashes, raw Docker Env, Vault/decrypted secrets,
Auth tokens, keys, logs, user metadata, table contents or customer/contact rows.
A blanket schema dump is not approved: it can include routine bodies/defaults.
Use a schema-only parsed catalogue package with an exact allowlisted object manifest.

## Local handling and rehearsal

Keep sanitized definitions in a task-private directory outside Git, mode0700/0600,
with checksums and an explicit object manifest. No external upload, hosted Test
import, repository artifact or iOS bundle. Retain only until the review/rehearsal
is finished; proposed maximum24 hours, then delete only named temporary exports
and compatibility resources. Keep aggregate counts/hashes and pass/fail evidence.
No existing backups, source files or Docker volumes are removed.

Start only disposable, explicitly named compatibility resources on this Mac using
the verified exact PostgreSQL/Auth/Storage/Edge digests. No public ports or ordinary
local website/Test stack. Use internal-only networking or network-none + exec,
fresh synthetic credentials/keys and fixtures, cron disabled, no Resend/APNs/SMTP
credentials or outbound real delivery. Rebuild the approved schema and apply only
the candidate deletion migrations; do not replay the production baseline onto a
live database or include Reports migrations.

Verify proof/rate limits, atomic future cancellation, anonymous past history,
role/account isolation, direct-role denial, old JWT/session and Storage/Realtime
access revocation, Auth deletion, receipt recovery, cleanup leases/retries and
notification suppression. Verify failed/interrupted cleanup without erasing a
real account. Remove only the manifest-listed containers/network/temporary files.
This provides the missing behavior evidence; production remains unchanged.

## Owner decision required

Approve the exact dependency/object manifest, parsed-definition filtering plan,
private local retention and disposable rehearsal before extraction. Any unmatched
routine or broader object/dependency requires further review. This approval would
not authorize production feature activation, real messages, account deletion,
dev/main merge, iOS upload or App Review submission.
