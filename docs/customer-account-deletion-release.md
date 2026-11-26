> **Versioned feature contract / historical phase record.** The original status,
> approval limits and verification results below belong to their stated phase.
> Read [the current handoff](handoff.md), [product/status inventory](../PRD.md)
> and source matching the target release before using these details. Earlier
> Test-only/pending wording is not today's deployment status or a new execution grant.

# Customer deletion: final production successor for review

Prepared 14 November 2026. This is a local, default-off review candidate, not a
production release, policy publication or App Store submission. It succeeds the
immutable `ee1b529` core rehearsal candidate based on main `55f7bb6`.
Reports and all temporary Apple probe routes, schema, code, fixtures and credentials
are excluded. The separate Test overlay retains Reports and its private gateway.

## Stable website/native contract

POST `/functions/v1/customer-account-deletion` on the selected deployment's API.
Test uses the existing private gateway; Live uses only
`https://srv1073968.hstgr.cloud`. Normal actions require a validated live current
customer session; account-linked manager/barber/admin responsibilities are denied.
A missing canonical name/profile does not force creation before deletion.

Core actions remain `preview`, `start`, `resend`, `verify`, `password`, `confirm`,
`status`, `retry`. Only status/retry use the dedicated id/receipt without an Auth
session. Receipts are opaque capabilities: Keychain on native, guarded browser
storage on web; never URLs, logs, analytics or a replacement login. The email
proof is purpose-bound, sent only to the verified server-selected account email,
expires after ten minutes, allows five wrong entries and bounded resend (one
minute, three sends). Successful proof is valid for five minutes. Confirmation
requires the latest preview digest and explicit future-appointment cancellation.
Changed scope requires another review, never silent cancellation acceptance.

Apple actions are additive and unchanged from the tested pilot:

| Action | Accepted fields | Safe response |
| --- | --- | --- |
| `apple-status` | `platform: ios\|web` | `available`, `registered`, `legacyManualFallback` |
| `apple-register` native | `platform: ios`, `identityToken`, `rawNonce`, `authorizationCode` | `registered:true` after encrypted storage |
| `apple-register` web | `platform:web`, `providerRefreshToken` | same; validate refresh grant, never reconsume Supabase's code |

The native authorization code is exchanged once. Do not retry an uncertain
registration with that code or silently reauthorize. Fresh later registration
requires a genuinely fresh owner-authorized grant and remains rate-limited.
Web registration is best effort and removes transient provider tokens from its
persisted Supabase session while preserving login and the booking draft.
Optional registration failure never creates a password or breaks sign-in.

Native validates the same initiating owner/stable session throughout async work.
A late registration/deletion/revocation callback must not clear a newer binding.
Handle Apple's native credential-state APIs only for the matching local session.
Actual accepted account deletion independently revokes server access/sessions;
the preserving-data provider diagnostic tested a local reset only.

`preview.appleRevocation`: `registered`, `manual_required`, `not_applicable`.
Receipt status adds `pending`/`revoked`. Final `appleManualRevocation` is
server-authoritative: never OR a stale preview flag into the final result.
A stored-token cleanup task prevents a false complete status until provider
acknowledgement; old grants with no usable token use the explicit manual fallback.
A real provider failure stays pending and supports safe durable recovery.

Only Apple registration accepts up to 32KB body, with 16KB identity token, 4KB
code and bounded ASCII nonce. Other actions retain 4KB. Caller owner/client ID,
redirect, provider URL and unknown fields are rejected. Expected errors include
`AUTH_REQUIRED`, `LINKED_WORK_ACCOUNT`, `TEST_ACCOUNT_ONLY`, `RECEIPT_INVALID`,
`CODE_EXPIRED`, `INVALID_CODE`, `REAUTH_REQUIRED`, `RATE_LIMITED`,
`CONFIRMATION_REQUIRED`, `APPLE_NOT_AVAILABLE`, `APPLE_PROOF_INVALID`,
`APPLE_UNAVAILABLE`, `EMAIL_UNAVAILABLE`. Preserve pending recovery for transport
uncertainty; do not interpret it as completion or start a second deletion.

## Environment/configuration guard

The parent deletion configuration requires the exact environment, website,
public API and explicit matching internal backend. Observed internal Live gateway
is `http://api-gw:8000`; other existing approved aliases remain explicit pins,
never arbitrary URLs. Production cleanup must be enabled before Apple capability
can activate. Both new-deletion and Apple switches remain false in this package.
Cleanup-only mode deliberately retains Apple capability for accepted jobs.

| Deployment | Native client | Web client |
| --- | --- | --- |
| Test | `com.barberplusplus.customer.test` | `com.barberplusplus.authentication.test.web` |
| Live | `com.barberplusplus.customer` | `com.barberplusplus.authentication.prod.web` |

Live requires the complete native/web pair. Mixed, unknown or partial Live
credentials fail closed. Both client-secret JWTs require ES256, valid key ID,
team `D49RFZQ6BT`, exact subject/audience, sane issuance and at most 180-day lifetime.
An independent 256-bit encryption key protects version-v1 envelopes. This guard
checks protected configuration metadata; Apple validates its signature during the
actual request. No Live signing key/token was read, generated or used here.

## Data and worker ordering

Nine migrations follow the unchanged main prefix: six core deletion migrations
plus three already-Test-verified Apple extensions. Existing migration hashes
remain unchanged. Private credential/attempt/task tables have RLS and no direct
API grants. The public service wrapper is service-only and hides its old bypass.
Registration and confirmation share account locks; confirmation freezes only
that account's stored credentials into the durable job.

Worker order is Apple revocation/lease acknowledgement, Storage removal, Auth
removal, then final database completion. Leases last two minutes; failures use
bounded backoff. Unlike one-use code exchange, idempotent revoke cleanup can
retry under a fresh job lease. Never retry with arbitrary IDs or claim completion
while files, Auth rows or provider tasks remain.

Future appointments are cancelled atomically, personal details/notes/favourites/
ratings/shares/notification capabilities removed, and anonymous historical date,
service and monetary records retained. Delivered emails, exports and other
external copies cannot be recalled; no invented legal retention period is promised.

## Required production operations, not performed

Use [the review package](release-review/customer-deletion-2026-11-14/README.md).
It defines exact-image rehearsal, credential/renewal/recovery, backup/ledger/cron,
privacy and owner approval gates. Configure nothing on Live from this document.
The production mail sender remains the existing Resend noreply address with Zoho
support Reply-To. Test remains capture-only; no real message was sent here.

The immutable earlier core rehearsal and the real Test Apple provider proof are
separate evidence. Neither proves the final production successor's exact-image
replay or that Live Apple credentials work. No full real-owner deletion occurred.
