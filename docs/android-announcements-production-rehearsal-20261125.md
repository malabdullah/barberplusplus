# Android announcements: production candidate rehearsal

25 November 2026. Source candidate only. Main, production, native binaries,
ordinary Android delivery and public publishing are unchanged.

## Scope

Two proposed migrations add the production Android announcement registry/queue
and a separate one-installation acceptance worker. Existing APNs registration
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
- Hosted `barber-test` (`qvkucvcjmojjbphlzlks`) rollback rehearsal passed twice
  with 28 SQL assertions, genuine synthetic Auth users/sessions, a synthetic
  admin MFA factor and the deployed customer-session/author helpers.
- The exact two candidate migration bodies were bound to a separate temporary
  namespace. Table shapes came from Test. No deployed Test function, runtime or
  transport was overwritten. The namespace and synthetic identities rolled back.
- Isolation assertions cover a queued unrelated Android delivery and pending
  iOS delivery, unchanged general flags, expiry, stale binding/version, suspended
  account, opt-out, permission epoch, one lease, no retry/rearm and no iOS/general
  worker delegation.

Limits: iOS delegation and production runtime/credential binding are contract
doubles in the namespace. Sender captures ran as handler tests, not an end-to-end
deployed acceptance HTTP request. This does not establish real FCM receipt/tap,
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
2. Apply only these two migrations and deploy matching `customer-announcements`
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
