# First-time native notification defaults

Hosted Test only, 12 November 2026. Production and main are unchanged.

New booking device/account preference rows already default `updates`,
`reminder24`, `reminder2` and `reviews` to true. Never overwrite saved values
with those defaults when signing in, reinstalling or refreshing registration.

The `customer-announcements` Function adds an optional boolean
`initializeDefaults` to `action: "register"`. Use it during first notification
setup with the normal signed-in bearer token and installation proof:

```json
{
  "action": "register",
  "deviceId": "<current installation UUID>",
  "deviceSecret": "<current installation secret>",
  "version": 1,
  "initializeDefaults": true
}
```

The SQL API inserts an enabled announcement preference only if this account has
no preference row. `ON CONFLICT DO NOTHING` preserves explicit Off and On values,
including a concurrent preference write from another device. Initialization
starts `enabled_since` now, preventing previously created campaigns from becoming
eligible. It does not enable the account/device master, obtain OS permission,
change an existing booking category, create a campaign, or send a notification.

Responses retain `enabled`, `version` and, for registration/preference requests,
`recipientBinding`. The new `preferenceConfigured` boolean distinguishes a
missing preference from a saved Off value. `status` and legacy registration
remain side-effect free. An absent preference remains Off until explicit first
setup or a normal preference change; old clients retain their current behavior.

Native integration must use the returned account preference as authoritative.
Do not optimistically force On when a request fails, and do not use
`preference(enabled: true)` as a first-setup substitute: that would overwrite an
existing opt-out. Keep the existing account/session and installation-generation
checks. Repeated initialization is safe, but ordinary registration should omit
the flag. A user changing a switch continues using `action: "preference"`.

## Verification

- Hosted Test migration and Function deployed; Function version 3.
- 22 rollback-only SQL assertions passed before and after deployment, covering
  missing/legacy preferences, repeated setup, explicit Off, another installation,
  fresh consent boundary, past/future campaigns, changed token, denied OS/master,
  expired session, installation proof, service-only ACLs and existing categories.
- Both Function handler tests passed, including flag type/action restrictions and
  trusted identity forwarding. No provider request or test alert was sent.
- Existing announcement/booking preference hashes, device count and private
  configuration hash matched before and after. Capture mode is unchanged.
- No frontend or native application change/deployment belongs to this patch.

## Production booking-master activation requirements

This is operational guidance, not an executed activation. A new reviewed
production access scope is required. It is independent of this defaults patch.

1. Inspect the actual shipped dispatcher, credential selectors, configuration,
   runtime and cron. Confirm master is paused and there are no unresolved sends.
   Do not print keys or tokens, import credentials, or run a broad claim as a
   diagnostic: claim materializes all due schedules and creates deliveries.
2. In one reviewed transaction, serialize booking event/schedule/delivery writes,
   capture one activation boundary after acquiring locks, expire pre-activation
   event intents and cancel their unsent deliveries, and consume already-due or
   expired schedules. Preserve sent history and valid future-due schedules. Do
   not modify appointments, users, category preferences or announcement jobs.
3. Enable only the booking master flag using the maintained configuration helper
   with the current complete legacy configuration and dispatch secret retained
   inside PostgreSQL. Preserve the separate environment credentials and runtime.
   Compare all non-flag configuration hashes before/after. Never export or
   reconstruct private keys in a command, file, log or chat.
4. After commit, allow the dispatcher's 60-second configuration cache to expire.
   Confirm the normal cron/wake path, inspect aggregate queue states and guarded
   eligibility, and verify there is no pre-activation backlog eligible to send.
   No synthetic alert or appointment is implicitly authorized by activation.
5. Restore the original SSH/firewall configuration and close temporary access.
   Record actual outcomes, including uncertainty. The passed manual TestFlight
   transport/tap checks do not certify automatic scheduler timing.

`configure_customer_push_runtime` selects API/topic/environments; it does not
toggle delivery. The booking master is `enabled` in the private APNs configuration.
There is no public admin-screen activation switch. Never toggle announcement
runtime or per-user consent as a side effect of booking-master activation.
