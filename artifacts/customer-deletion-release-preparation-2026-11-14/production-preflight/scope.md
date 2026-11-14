# Proposed production metadata preflight

Status: PREPARED ONLY — owner access approval pending. No Live connection, IP lookup or firewall action has been performed for this packet.

## Target and duration

Database VPS **72.61.164.64**, Hostinger resource **1073968**, expected hostname `srv1073968`, only. No frontend VPS or management port access. Source application remains frozen at `e32cfb9105c2652fab8c2065af7280bf7dc76ec9`; this proposal changes no application files.

After separate approval, request this Mac's public IPv4 once from `https://api.ipify.org?format=json`. This discloses the public IP to ipify. Validate a globally routable IPv4, then permit exactly that `/32` on TCP 22 for at most one hour. If the address changes, stop and restore access; a different source requires fresh approval.

## Temporary access and restoration

1. Verify the current database firewall profile and every rule in Hostinger; privately record the original binding and rule digest. Historical profile 367995 had five rules, but its current state must be checked rather than assumed.
2. Confirm that the Hostinger restore controls work before changing access. Clone the actual original configuration into a dedicated temporary copy and add only the approved IPv4/32 TCP22 rule before deny. Bind the copy to the database VPS only. Do not mutate a shared profile, touch the frontend VPS, discard other profiles, widen any original rule, or expose port 3000. Stop if an isolated copy cannot safely be created or its preserved rules cannot be proved.
3. Connect using the existing database inspection SSH identity and previously verified host key, with BatchMode, IdentitiesOnly, no PTY, no forwarding, no connection sharing and no LocalCommand. Never bypass a forced-command release key, accept a changed host key, create keys, reset passwords or modify SSH/HBA configuration.
4. Stream the reviewed `inspect_metadata.py` through SSH stdin into `PYTHONDONTWRITEBYTECODE=1 python3 -`; do not install or copy a script to the server. It accepts no arguments, verifies root and the fixed hostname, and has a 180-second deadline. At most two identical attempts are permitted for transport failure; drift, unsafe metadata or unexpected configuration stops for review.
5. Save only the whitelisted JSON result locally with mode 0600. Do not print raw command output, environment, stderr, config documents or credentials. Retain aggregate evidence and its hash.
6. Immediately after success or failure, close SSH, restore the recorded original database firewall profile, verify its active binding and unchanged rules, remove the exact temporary rule from the unused copy, and verify no inspection connection remains. Stop new inspection by minute 45, reserving 15 minutes for restoration.

The one-hour limit is an operational deadline, **not a provider-enforced automatic expiry**. No Hostinger automatic TTL is established and no remote rollback job will be installed. If this chat is interrupted, use the database VPS firewall controls to restore the recorded original profile and remove only the temporary rule. Do not reopen access while waiting for a further approval. An unavailable restore path blocks activation.

## Exact read scope and output whitelist

- Four fixed Supabase containers: immutable image IDs compared with the reviewed lock, running and health state; known host architecture.
- Auth/Functions environment: selected public environment bindings and feature flags only. Existing Apple JWT/cleanup-client JSON is parsed **in memory on the VPS** for public client/key identifiers, expected team/audience booleans and issued/expiry timestamps. JWT values, signatures, arbitrary claims and unknown identifiers are never exported. No signing or provider request occurs; signature validity and Apple portal permissions are not verified.
- Encryption, service-role, anonymous API, mail and cron keys: Docker-side **presence booleans only**, not their values. The Apple `.p8` reference receives a bounded path/ownership/permissions stat only; its contents are never opened.
- Five fixed root-private JSON metadata documents: Apple renewal configuration/state, backend configuration/state and original backup-readiness receipt. Export only the selected public identifiers, known enums, timestamps, booleans, counts and release commit. No arbitrary path, backup object identifier, system identifier or unknown configuration field is returned.
- Three fixed installed public helper files: SHA-256 only, compared with reviewed source. Helpers are not executed; no release/renewal/backup commands, locks or state writes.
- Two fixed systemd timers: load/active/substate/enabled state and last/next trigger metadata only. No journal, service environment, command bodies, timer/service start/stop or enable/disable.
- Six fixed SQL queries, always inside `BEGIN READ ONLY` with an 8-second statement timeout and `ROLLBACK`: selected catalogue existence/permissions and routine hashes, authoritative migration name/hash prefix, stored schema fingerprint, three named cron schedules/active flags/command hashes, aggregate deletion queue counts, aggregate Apple credential/task counts if those tables exist. Database system ID is compared on-server solely for backup binding and never exported. No account identifiers, customer records, tokens, ciphertext, routine bodies, logs, Auth/session rows or arbitrary caller SQL.
- Backup receipt: capture/verification ages, 26-hour freshness, original policy/provider, binding and restoration flags, recorded restoration duration and same-system boolean. No backup/cloud download, new restoration or receipt refresh.

The script returns `METADATA_CAPTURED_REVIEW_REQUIRED`, never release approval. Missing tables/configuration or mismatches remain review gates; it will not create or repair them. A generic unavailable result contains no raw exception or command output.

## Verification and limits

Thirteen synthetic-only Python tests pass, covering whitelist/redaction, multiline JSON environment projection, malformed/expired metadata, wrong client/configuration, missing/drifted ledger, stale/future/wrong-system/incomplete backup evidence, fixed read-only queries and unapproved targets. These tests do not claim a real remote Docker/template execution; actual execution awaits access approval.

This scope cannot attest the frontend running image/commit, Dokploy routing, TLS, full Live schema drift, Apple key cryptographic suitability/portal scope, or a fresh backup restoration. It cannot provision Live deletion credentials, rotate keys, deploy migrations/Functions/frontend, activate deletion, create reviewer accounts, send email/SMS/push, use Apple authorization, publish accepted wording, upload, submit or publicly release the app. Each remaining necessary action will be prepared separately.

`support@barberplusplus.com` is proposed for a later dedicated App Review customer account. This packet includes **no lookup, eligibility check, inbox use, delivery or provisioning** for that address.
