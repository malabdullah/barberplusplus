# Customer account deletion — hosted Test pilot

## Scope and release boundary

Only hosted Supabase `qvkucvcjmojjbphlzlks` and the Cloud Test website are enabled.
A server-side allowlist additionally requires trusted `app_metadata.deletion_qa`
and an `@example.test` identity on **every** linked Auth alias. Normal customer,
owner, staff and admin accounts cannot be deleted by this pilot. Dev, main and
production are unchanged. Do not remove this gate as part of native integration.

The owner approved future-appointment cancellation and irreversible anonymized
soft deletion. Future means pending/confirmed appointments whose **start** is
still in the future in Kuwait time. Already-started/past appointments keep their
status and anonymous service/date/amount history. Cancellation cutoffs do not
block this explicit account-deletion operation. No future appointments are moved.

## Native and web API

POST `/functions/v1/customer-account-deletion` on the Test project, through the
existing authenticated Test gateway/transport. Website uses
`/test-api/customer-account-deletion`. Keep the access password/gateway secret out
of source control. Function independently validates bearer JWT + live session.
Normal request: JSON `{ "action": "preview" }`. `apikey` is the normal Test
publishable/anon key. Bearer token is required for all actions except `status`
and `retry`. Caller cannot supply email, user ID, session ID or affected bookings.
Extra fields are rejected. Bodies are limited to 4096 bytes, POST only, no-store.
Native requests omit Origin. A browser Origin must match the exact Test origin.

1. **preview** → `upcoming` (first 50), `upcomingCount`, `hasMore`, `digest`,
   `providers`, masked `destination`, `methods` (`email_code`, `password` where
   available), `appleRevocation` (`manual_required` or `not_applicable`).
   Appointment entries contain id, shop/shopAr, barber/barberAr, date and time.
   The date/time is Kuwait civil time; never interpret it as device-local time.
2. **start**, with client-generated UUIDv4 `id` and optional `language` (`en`/`ar`)
   → `id`, opaque 43-character `receipt`, state, expiry and updated preview.
   Save id + owner before request; save receipt securely before allowing confirm.
   Retries with the same id/session return the **same** receipt without sending
   another email. Receipt is stored encrypted server-side before confirmation;
   only its hash is used to authorize status. No password/code is persisted.
3. **verify**, with id, receipt and six-digit `code` → state `verified`, expiry.
   Code is purpose-bound to this operation and the server-owned verified email,
   expires after 10 minutes, and permits five attempts. Invalid attempts persist.
   Apple relay/Google email are treated as the verified account address.
   Test mail stays in the protected Test inbox; no real email is sent.
4. **password**, with id, receipt and current `password`, is an alternative for
   accounts with a password. Scope/rate validation reserves an attempt before
   credential checking. Email/phone is looked up server-side. This does not
   change the password or leave its temporary verification session signed in.
5. **resend**, with id, receipt, optional language: at least 60 seconds between
   sends; maximum three messages per operation and three starts per hour.
   A resend resets proof and starts a new 10-minute code window. Successful
   email/password proof permits confirmation for five minutes.
6. **confirm**, with id, receipt, preview digest and
   `confirmCancellation: true`. Show an explicit irreversible-deletion warning
   and future-cancellation confirmation first. If appointments changed, HTTP200
   state `review_required` supplies a new preview/digest. Show it and require
   confirmation again. Nothing is deleted in that response. If scope/role changed,
   confirmation is denied. On accepted deletion, HTTP202 `cleanup_pending` plus
   `cancelledCount`: database anonymization and session revocation are committed,
   while owned Storage objects and Auth identities finish in background.
7. **status**, id + receipt only → HTTP202 `cleanup_pending` or HTTP200 `complete`
   (also awaiting_code/verified before confirmation), `cancelledCount`, and
   `appleManualRevocation`. No PII is returned. **retry** has the same input and
   may request cleanup; the server's two-minute lease and backoff remain binding.
   Poll slowly while visible (website uses 3 seconds); no second delete operation.

Persist the receipt in Keychain until completion or explicit reset. A timeout on
confirm is an **unknown outcome**, not a failed deletion: query status with the
saved receipt. Never require a revoked session to retrieve status, repeat signup,
or restore data. Never automatically start a replacement delete operation.
Anonymous completed receipts expire after seven days; abandoned pre-confirmation
requests are purged after their expiry plus one day. These are operational job
lifetimes, not a legal personal-data retention policy.

## Errors and safe recovery

- `AUTH_REQUIRED` (401): sign in again before proof; status still uses receipt.
- `TEST_ACCOUNT_ONLY`: pilot excludes this identity; no deletion occurred.
- `LINKED_WORK_ACCOUNT`: shop/staff/admin responsibilities need support review.
- `ACCOUNT_SCOPE_CONFLICT`: linked profile/alias scope changed; stop for review.
- `INVALID_CODE`: incorrect code/password; do not log or echo the proof.
- `CODE_EXPIRED`, `REAUTH_REQUIRED`: get a new code/proof before confirmation.
- `RATE_LIMITED` (429): wait; never loop requests or credential checks.
- `RECEIPT_INVALID`: do not create a second operation after an uncertain confirm;
  retain local receipt and offer support.
- `DELETION_IN_PROGRESS`, `CONFIRMATION_REQUIRED`, `INVALID_REQUEST`: correct the
  current step; no guessing IDs, identities or future appointments.
- `EMAIL_UNAVAILABLE`, `UNAVAILABLE` (503), `NOT_ENABLED` (503): preserve recovery
  state. Retry the same start if its response was lost, or query status after a
  confirmation timeout. Do not claim deletion completed while cleanup is pending.

## Device/account isolation

Clear only the deleted owner's session, cached profile, booking/contact drafts,
biometric-unlock credential and notification binding. Compare the active account
and a session-generation marker before applying asynchronous responses. A user
who switched to another account must keep that account's session/preferences.
Do not globally reset all Keychain entries, delete every notification device or
unregister a device that has since been rebound to a different account.

Database deletion removes owned notification registrations before deleting Auth
sessions, because the existing session trigger otherwise detaches their ownership.
Guest links to the deleted customer's bookings are removed; another account using
that device remains intact. Old JWTs are denied through live-session checks,
including restrictive Storage/Realtime policies. The current app-verified canonical
phone is included in deterministic contact cleanup even when auth.users.phone is
empty; unverified guessed names/numbers are never identity matches. User-editable metadata is not an
eligibility grant.

## Apple, privacy and remaining release requirements

Automatic Apple-token revocation is **not implemented or tested**. No Apple
signing key was copied. Existing web Services ID is verified; native key/client
scope is not. When tokens are unavailable, Apple TN3194 permits app-data deletion
and directing the user to revoke access in Apple Account settings. Native must
show the manual fallback honestly; public-release acceptance is still separate.

The Test privacy draft covers native sessions, local biometric behavior, push
identifiers, provider technical/diagnostic information and immutable sharing.
Delivered mail, downloaded exports, recipient copies, support inboxes and provider
backups cannot be recalled by this database transaction. Do not invent a legal
retention period or claim all external copies were erased. Final App Privacy
answers, production policy and production migration require owner acceptance.

## Verification

- Deno handler tests: hostile input/auth boundaries, masked destination, stable
  receipt, AES-GCM tamper/AAD/key isolation, proof reservation, receipt-only
  recovery, changed-appointment review and generic safe failures.
- Rolled-back hosted database suite `supabase/tests/053_customer_account_deletion.sql`:
  pilot/role/session scopes, throttles/proof attempts, future cancellation, old
  JWT denial, anonymous history, tombstone guards, shares/ratings/favourites,
  reused devices, report invalidation and leased Auth cleanup. Zero persisted
  fixtures from that suite.
- Actual hosted Function exercise: captured code, wrong/right proof, consent,
  confirmation, durable receipt, background recovery, Auth404 and old-token401.
  Caught and corrected GoTrue's rejection of an infinite suspension timestamp.
- Browser/unit coverage checks unknown outcomes, account switching, re-confirmation,
  public support and report-export invalidation before and after file buffering.
- Separate disposable website/native pilot credentials live only in the ignored
  private `.cloud-test/deletion/qa.json`; never include them in artifacts or chat.

Production work remains explicitly scoped in [production readiness](customer-deletion-production-readiness.md).
