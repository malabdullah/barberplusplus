> **Historical preparation/evidence — not a current execution instruction.**
> Preserve the original record below. Read [the handoff](handoff.md) and the current PRD,
> runbooks, target identity and approved release receipt before acting. A candidate,
> old approval or preparation checklist does not establish current production state.

# Android announcements: production candidate rehearsal

25 November 2026. Source candidate only. Main, production, native binaries,
ordinary Android delivery and public publishing are unchanged.

## Scope

Three proposed migrations add the production Android announcement registry/queue,
a separate one-installation acceptance worker and scoped fresh enrollment. Existing APNs registration
and queue tables are retained. Customer preference, frozen recipient binding,
session/ownership and token-version checks apply to Android announcements.

The acceptance worker never invokes a general claim/continuation, never changes
general activation, and never retries. A service-only operator configures one
already-frozen delivery for at most ten minutes. It must belong to a preview
campaign with exactly one target and one Android delivery and no iOS delivery.
Normal workers cannot claim that preview campaign. The selected delivery may
receive one lease/attempt. Permission, token, session, capability, opt-out,
registration or scope changes invalidate it. Even HTTP 503 is terminal here.

## Verification

- 17 Deno handler/payload tests passed with injected senders and no provider calls.
- Candidate dispatcher entry point type check passed with remote imports denied.
- Changed Function files passed Deno lint. Vite build passed, with existing
  Recharts/chunk-size/import warnings.
- Hosted `barber-test` (`qvkucvcjmojjbphlzlks`) rollback rehearsal passed repeatedly,
  with 37 assertions in the final run, genuine synthetic Auth users/sessions, a synthetic
  admin MFA factor and the deployed customer-session/author helpers.
- The exact three candidate migration bodies were bound to a separate temporary
  namespace. Table shapes came from Test. No deployed Test function, runtime or
  transport was overwritten. The namespace and synthetic identities rolled back.
- Isolation assertions cover a queued unrelated Android delivery and pending
  iOS delivery, unchanged general flags, expiry, stale binding/version, suspended
  account, opt-out, permission epoch, one lease, no retry/rearm and no iOS/general
  worker delegation. Scoped enrollment additionally rejects an unapproved device,
  wrong capability and invalid session; it consumes its allowance after one
  successful normal registration without opening ordinary registration.
- An isolated hosted Test HTTP Function passed real synthetic password sign-in,
  JWT verification, Test gateway, deployed device status and announcement
  capability registration, then the shared captured dispatcher: HTTP 200,
  claimed 1, captured 1, accepted 0, external provider calls 0. Missing JWT was
  rejected with 401; missing Test gateway with 403. The synthetic device registry
  fixture was prepared separately so existing owner-device allowlists and finite
  Test registration counters stayed untouched. Fresh production-style enrollment
  was checked separately in the rollback namespace, not claimed as one continuous
  production HTTP test.
- The QA Function was deleted. Its one disposable Auth account/session, customer
  profile, device, announcement capability/preferences and push preferences were
  removed; rollback namespace absence was verified. The protected temporary input
  was removed and the coordinator retired its temporary gateway handoff.
- Full application lint, Function lint/type checks, Function tests and frontend
  tests passed. Four operations tests initially hit sandbox loopback-listener
  denial; the separately permitted operations rerun passed all 84 tests.
  Migration filenames, domain checks and build passed.

Limits: iOS delegation and production runtime/credential binding are contract
doubles in the namespace. The capture HTTP check uses the existing Test transport
and a single synthetic job; queue isolation is separately proven by rollback SQL.
This does not establish real FCM receipt/tap,
current production credential validity or Compact registration. These are release
gates, not claimed passes. Initial rehearsal harness parameter/schema mismatches
were corrected before the two passing runs; failed attempts rolled back.

Reproduce: run `python3 ops/qa/android-announcements/prepare_rehearsal.py`, then
execute its generated rollback-only SQL **only on barber-test**. No Docker or
localhost runtime is required. The generator records both source SHA256 values.

## Minimum proposed Live release — requires separate owner approval

1. Review the immutable commit and two migration hashes. Confirm production has
   the existing live Android transport and current announcement/defaults schema.
   Verify backup/recovery and normal release-controller gates using the usual
   separately approved access window.
2. Apply only these three migrations and deploy matching `customer-announcements`
   and `admin-push-dispatch` Functions. No website/native UI update is required.
3. Leave `ANDROID_PUSH_ENABLED`, `ANDROID_ANNOUNCEMENTS_ENABLED`, database general
   delivery and Android-announcement activation unchanged/off. New
   `ANDROID_ANNOUNCEMENT_ACCEPTANCE_ENABLED` defaults absent/false.
4. Prove a legitimately registered current Compact installation/session exists,
   including its announcement capability. Reference the existing FCM secret
   `customer_android_live_fcm`; never export it. If registration is disabled and
   Compact is not registered, stop for a reviewed installation allowlist. Do not
   enable broad registration or fabricate an enrolled device.
5. Separately approve one neutral campaign/target/delivery for Compact, exact
   destination, short expiry and one send. Freeze current token hash, recipient
   binding, registration version and eligibility epoch. Preview state prevents
   general workers claiming it. Configure via service-only
   `admin_push_worker('acceptance-configure', {deliveryId})`.
6. Temporarily set only the new acceptance env flag true. Invoke the existing
   dispatcher once with `x-push-purpose: android-acceptance` and its existing
   private dispatch secret. This selects only acceptance-* actions, not normal
   claims. Validate again immediately before FCM. No automatic retry, even after
   uncertainty. Owner verifies receipt and tap on Compact.
7. Set the acceptance flag false/remove it and clear the scope with
   `acceptance-configure` and a null deliveryId. Preserve the terminal result;
   no queue deletion is needed. Verify other queue rows/flags were unchanged,
   close SSH, restore the original firewall and remove its temporary rule.

Rollback before activation: restore prior Function artifacts and keep all new
flags/runtimes off; new schema is additive and may remain inert. Do not drop
registrations/history. If the single attempt is uncertain, stop and inspect its
sanitized outcome; never rerun the campaign automatically.

## Compact enrollment while general Android access is closed

The original two-Function candidate cannot admit a fresh Android registration
while `ANDROID_CUSTOMER_ENABLED` is false. Its companion change also updates
`customer-auth`. Deploy the three reviewed migrations before the three Functions.
Keep the existing Android customer and general delivery flags disabled.

Before arming the one-time database grant, independently match the owner-supplied
Apple address, authenticated customer and installation. Check for an existing
registration and preserve the current preferences. With Compact ready, set
`ANDROID_PUSH_ENROLLMENT_SCOPE` on the Functions runtime from a protected
operator file. Its JSON contains `userId`, `deviceId`, `secretHash`,
`startsAtMs` and `expiresAtMs`. The integer timestamps are Unix milliseconds.
The interval must be active and at most ten minutes. Use the SHA-256 fingerprint
from the app's enrollment code. Never include the raw device secret, session or
FCM token. Keep the runtime scope and SQL grant windows aligned.

Only authenticated `push-register` and `push-status` from the matching customer
and installation can pass this extra HTTP gate. The existing database grant,
session, token and version checks still apply. Clear the temporary runtime scope
and database allowance afterward. A failed or uncertain send ends the attempt.

## Conditional privacy copy for the coordinator

Publish only with the corresponding capability/activation, replacing the older
claim that Android never receives administrator announcements.

**English:** When enabled, Barber++ can send service updates from its
administrators to your signed-in app, alongside booking notifications. Delivery
uses your notification preferences and the current app installation. We register
an installation identifier, notification token, language and account/session
binding to route updates to the correct device. These updates do not create a
customer message inbox and are not used for cross-app advertising.

**العربية:** عند تفعيل الميزة، يمكن لإدارة Barber++ إرسال تحديثات الخدمة إلى
التطبيق المسجّل بحسابك، إلى جانب إشعارات الحجوزات. يعتمد الإرسال على تفضيلات
الإشعارات ونسخة التطبيق المثبتة حالياً. نسجّل معرّف التثبيت ورمز الإشعارات
واللغة والربط بالحساب والجلسة لإيصال التحديثات إلى الجهاز الصحيح. لا تنشئ هذه
التحديثات صندوق رسائل للعميل ولا تُستخدم للإعلانات عبر التطبيقات.

Application search terms are used as query predicates and have no intentional
search-history write/logging path. Current infrastructure body/SQL-bind/error
logging settings and retention were not verified: no ephemeral-processing claim
should rely on this application-only inspection. Session/activity/Auth request
metadata is stored. Google provider metadata may retain a picture URL even
though the Android account model does not fetch/display those picture bytes.

## Scoped registration and rehearsal baseline correction

`20261125101118_android_registration_single_acceptance.sql` retains the existing
registration validators and permits one account/installation/capability-hash
tuple for ten minutes while ordinary registration and delivery stay false. The
session is derived from the normal authenticated request and checked by the
deployed session helper; no private session, FCM token or raw device secret is
exported to configure the scope. Only the service role can configure/clear it.
An exact retry after a lost successful response reads existing status without
creating another enrollment; changed token/version/session still requires scope.

The first namespace rehearsal loaded the original transport routine without its
existing `20261120154802_android_live_fcm_token_validation.sql` correction. That
omission misleadingly exposed the historical PostgreSQL `{20,4096}` defect, which
is already fixed in the committed main baseline. Full CI caught the candidate's
redundant patch. The harness now includes that corrective migration and the
candidate preserves its separate token-length/alphabet checks. This task does
not establish a new production token-validator defect or change those rules.

Build 12 currently has no intentionally exposed pre-registration enrollment
identifier. The smallest proposed owner-consent path is a temporary read-only
enrollment code in notification settings: random installation UUID plus a
non-secret SHA256 capability fingerprint, with the verified account chosen
through the coordinator. It must not expose a session, token or device secret.
Configure only that code, then use normal Enable notifications. This native
prerequisite must be completed/reviewed before a strict one-installation Live
registration; do not inspect private app storage or enable broad registration.

## Controller, interruption and recovery decision

New tables/routines/RLS are outside automatic additive-only admission. Before
any main merge, arrange a separately approved manual database window and pause
the controller to avoid automatic rollout racing the three reviewed migrations.
Verify the exact ordered hashes against both ledgers; do not rewrite prior
migrations. Apply matching Function artifacts only after SQL verification, then
reconcile/resume the controller using the reviewed receipt.

The changed managed Functions are `customer-announcements` and
`admin-push-dispatch`. The current backend helper drains and briefly stops the
shared Functions runtime while replacing changed workers. Other Functions may
therefore see a short availability gap; Auth, REST and the website are not
intentionally stopped. Duration must be measured during the approved release;
zero downtime is not promised. Stop/recover if readiness fails rather than
restarting or retrying blindly.

Before/after health checks: fresh original backup/restore receipt, accepted
migration ledgers, pinned runtime/image identity, healthy Auth/REST/Realtime/
Storage/Functions, own-domain HTTPS, current release/runtime commit, anonymous
denials on private RPCs, unchanged iOS/defaults contract and all general Android
flags still off. Verify configured scope expiry/recipient count before enabling
only the temporary acceptance flag. Never test by draining general queues.

If deployment fails, restore the prior two Function artifacts and previous
compatible frontend artifact if it advanced, clear only registration/acceptance
scope rows and set the temporary flag false. Retain additive SQL, registrations
and customer writes. The patched normal registration API is backward compatible;
do not drop new schema or reverse SQL automatically. Reconcile actual state and
controller receipt before any retry. No Live health check or backup claim was
made during this Test/source task.
