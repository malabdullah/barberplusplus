# Manager-only server installation contract — not executed

The coordinator owns credential retrieval, private transport, installation and cleanup. Website must not read Keychain or receive the Google JSON. All values below are public configuration or parameter placeholders. No credential installation or activation is authorized by this document.

## Inputs

- Exact reviewed candidate commit and artifact/checksum; six migration filenames/hashes in `configuration-manifest.json`.
- Coordinator's existing custody receipt for the one active Google service-account key. Retrieve the complete JSON only into protected manager/server memory or a temporary `0600` file inside a `0700` directory. Delete only temporary transport copies after verification; preserve canonical Keychain custody.
- Credential JSON must have `type=service_account`, `project_id=barber-plus-plus-phone-prod`, `client_email=barber-android-sender@barber-plus-plus-phone-prod.iam.gserviceaccount.com`, a 40-lowerhex `private_key_id`, PEM PKCS8 `private_key`, and `token_uri=https://oauth2.googleapis.com/token`. Never substitute the Test credential or Firebase client SDK config.
- Separately generate 32 cryptographically random bytes as 64 lowercase hexadecimal characters for the fixed `customer_android_live_dispatch_secret` name. No existing APNs secret is reused.
- Fixed Live backend `https://srv1073968.hstgr.cloud`, package `com.barberplusplus.customer`, Firebase project `barber-plus-plus-phone-prod`.

## Server-only database command/input batch

Use the existing approved private server installer/database transport. Bind parameters server-side or feed its protected input stream; do not put the JSON/secret into shell arguments, environment dumps, command logs or chat. Ensure the existing installer redacts SQL/error output before supplying secret values.

1. Preflight public identity only:

       select api_url from private.customer_push_runtime where singleton;

   Require the exact Live backend. Require the two new Vault names to be absent before first installation. If either exists, stop and review its identity privately; do not silently overwrite it.

2. In one transaction, store only the two new fixed-name entries with bound values:

       select vault.create_secret($1, 'customer_android_live_fcm', 'Dedicated Android FCM send-only credential');
       select vault.create_secret($2, 'customer_android_live_dispatch_secret', 'Dedicated Android scheduled wake authentication');

   `$1` is the standard JSON serialized as text. `$2` is the independent 64-lowerhex random secret. This installation does not change runtime flags or activate the cron. Return only success and public project/sender/name-match booleans, never decrypted values or credential fingerprints.

3. Install matching server Functions/website from the reviewed artifact. Preserve all existing environment values, including Apple/APNs, iOS/Web audiences and booking email settings. These additional environment flags stay false initially:

       ANDROID_CUSTOMER_ENABLED=false
       ANDROID_PUSH_ENABLED=false

   Existing `APP_ENV=production`, `APP_URL=https://www.barberplusplus.com`, and `CUSTOMER_PUBLIC_API_URL=https://srv1073968.hstgr.cloud` must match. Do not change the existing internal `SUPABASE_URL` or service credential.

4. Verify defaults with metadata only:

       select environment, api_url, project_id, package_name,
              registration_enabled, delivery_enabled, mode, sender_email
       from private.android_live_push_runtime where singleton;
       select jobname, schedule, active from cron.job
       where jobname='customer-android-live-push-dispatch';

   Expect both DB flags false, capture mode and inactive cron. Do not return Vault contents.

## Separately reviewed activation

After matching helpers/provider redirects, artifact/CI/image review and device-test approval, the service-only call is:

    select public.configure_android_live_push($1::jsonb);

Its exact public JSON fields are `apiUrl`, `projectId`, `packageName`, `senderEmail`, `registrationEnabled`, `deliveryEnabled`, `mode`. Start registration-only (`true,false,capture`) with the Auth flag enabled and delivery still held. Real delivery requires a separate reviewed call (`true,true,send`), `ANDROID_PUSH_ENABLED=true`, and activation of only the new cron via `cron.alter_job(job_id, active:=true)`. Enabling delivery resets the no-history activation boundary. The actual real alert/device must be approved; no alert is part of this preparation.

The existing Google Web audience is the Android server audience; the three Android OAuth clients identify the signed app but are not replacements for that Web audience. Append only the five tested redirect strings from the manifest; leave all other Auth/provider values intact.

## Rollback boundary

Disable the two Android environment flags, call the same service-only configuration with registration/delivery false, and deactivate only the new cron. Restore prior Function/website/Worker versions using their receipt. Retain additive tables, device replay fences and terminal delivery outcomes. Do not replay events, drop tables, overwrite iOS/APNs secrets or change customer accounts. Any removal/revocation of newly created Google credentials remains coordinator-owned and separately approved.
