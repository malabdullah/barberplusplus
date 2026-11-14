# Review and approval package

Status: **prepared for review; release gates remain open**. No production access,
key use, new Docker runtime, dev/main push, policy publication, reviewer account,
App Store upload/submission or public launch is authorized by this package.

## Included and excluded

Main-based core deletion/support/privacy plus the three Apple migrations,
server/native/web API, cleanup worker and exact environment guards are included.
Reports and the temporary preserving-data Apple probe are excluded. The held
native 1.0.0(25) archive is coordinated separately; its API contract is
`docs/customer-account-deletion-release.md`. A signed archive or local source
manifest is not a released/attested frontend image.

## Completed preparation

- Main/dev remote heads reconciled read-only; main55f7bb6 and dev0a5da71 unchanged.
- Focused deletion Function37, complete main-based Function247, UI361 and operations65
  tests passed; lint/types/migration/domain checks and build passed.
- Hosted Test Function7, SHA `1d7c9a6187de66c1e5e9527ae3a4fb82223a9416c72504ac18386d61fafb0dbc`.
  Existing Test native/web credential metadata also passed the new guard offline,
  without changing activation or reading any Live credential.
  Ten actual hosted capability/input/auth/origin/preview checks passed without
  messages, Apple calls or deletion requests. Normal Apple activation remains off.
- Core055 six groups and Apple056 eight groups passed on Test with full rollback;
  only newly created UUID fixtures were used. The owner renewed exact core055
  consent after two tool confirmations expired; its reviewed SHA is
  `b5c1cf527cae9bdc20eff9b48bc38479bb2b43a96b081c66eb6a6bc506ecaec9`.
- New read-only Apple readiness SQL passed on Test: private RLS/API grants and
  wrapper bypass closure verified; no stored Apple credentials/tasks. A pre-existing
  unscoped Test pending row has no accepted user array, Auth/Storage objects or
  provider task. It was preserved, not treated as a new customer deletion or fixed
  by deleting unrelated data. Its provenance/retirement remains separate QA work.
- Exact held native25 core passed an additional hosted v7 compatibility test
  (one test, zero failures/skips), using only the existing synthetic native fixture,
  without deletion, message/provider call or owner phone access.
- Separate real Test provider proof: one exchange/revoke accepted, local Test
  reset observed, same account restored,12/12 bookings and business hashes retained.
  It was not a real account-deletion end-to-end test and is not being repeated.

## Gate 1: exact combined candidate rehearsal — approval still needed

The older immutable six-migration rehearsal passed47 SQL suites/1,136 assertions
plus real Auth/Storage cases. It does not cover the later Apple migration/worker
combination. Start no runtime until the owner approves this concrete new run.

Proposed resources: uniquely operation-labelled disposable PostgreSQL, Auth
migration bootstrap/Auth, Storage and probe containers on one internal-only network,
plus the separate pinned Edge compilation check. Exact image IDs/digests come from
`ops/release/runtime-lock.json` (PostgreSQL17.6.1.136, Auth2.189.0, Storage1.60.4,
Edge1.74.0). No published ports, production rows/keys, real Apple/mail/push, active
cron, ordinary localhost site or reset of existing Test. Synthetic keys/users only.

After approval, run from the frozen candidate:

```sh
python3 ops/account-deletion/rehearse-platform.py --source . --evidence .release-private/final-platform-rehearsal.json
```

Also run `python3 ops/release/test-functions-image.py --source .`, the existing
pinned Edge compilation/closed-handler harness, with synthetic configuration and
default-off activation. It imports pinned public modules over the network; no
production service or provider endpoint is contacted.
Reconcile all48 candidate SQL suites, unchanged baseline/migration hashes, expected
public schema, grants/RLS and Apple lease/ownership/replay/legacy branches. Recheck
actual Auth hard deletion, old JWT/refresh/Storage denial,501-object boundary,
interrupted cleanup, backoff/stale leases, receipt recovery and another-account
isolation. Positive provider behavior remains injected; the real provider proof
is recorded separately. Remove only that run's labelled resources in finally and
independently verify absence. Do not prune Docker globally or upgrade images.

Deletion-specific native coverage on Duo currently proves preview/proof/Keep;
a full final destructive Duo journey is not claimed. Reconcile the final native
Duo/17 Pro/16e evidence with the exact archive, completing safe synthetic checks
or recording an explicit accepted limitation before claiming full device coverage.

## Gate 2: Live credential/renewal/recovery approval — no key use yet

Obtain explicit approval for the actual production Apple key/client scope before
reading/using it for this new purpose. Verify the production group and both exact
client IDs from the contract. Do not reuse Test material or assume the existing
web-login renewal also rotates the new Edge credentials.

Provision outside Git/chat: native+web client-secret JWT JSON in
`CUSTOMER_APPLE_REVOCATION_CLIENTS`, independent random64-hex
`CUSTOMER_APPLE_ENCRYPTION_KEY`, independent `CUSTOMER_APPLE_REVOCATION_ENABLED`
and the existing core cleanup/backend switches. Preserve existing Resend/Auth
settings and keys. Retain a protected encryption-key recovery copy separately
from the database; confirm the encrypted off-host recovery procedure covers it.

Prepare/install/review a renewal path for BOTH client secrets before their maximum
180-day expiry, with protected metadata-only expiry alarms and safe atomic updates.
Keep encryption key/version stable while any stored envelope or task remains.
Neither key rotation nor deletion of envelopes is a way to clear a release check.
If an external revocation result is uncertain, retain durable pending state and
use the same bound task under the normal worker lease/backoff rules.

A separate approved Live-client verification is still needed; no real calls are
authorized by this package. Do not delete the owner's regular Test or Live account.

## Gate 3: public wording and native disclosures — owner acceptance needed

`proposed-public-copy.json` contains exact English/Arabic privacy and public
support copy extracted from this candidate. It is unpublished proposal text.
Accept the description of anonymous history, provider/backups/external copies,
Apple encrypted tokens/legacy fallback, support and SDK data collection together
with the matching native App Privacy draft. This is not legal/App Review approval.
The proposed contact wording describes optional guest phone and conditional
verification without changing either checkout mode. Verify it against the final
deployed mode before publication; no new contact policy is introduced here.

## Gate 4: controlled release — separate owner approval needed

Freeze exact source/manifest and matching native artifact. Then obtain approval
for dev→main→production, any needed narrowly scoped server access, verified Live
credential setup and any specific disposable Live acceptance record/message.
No production fixture or reviewer identity is included in current authorization.

During that approved release, verify fresh encrypted off-host backup/restore
receipt (current26-hour gate), exact live images/ledger/config and migration prefix.
Apply only pending reviewed SQL/Functions, never baseline CREATE TABLE replay or
a copied Test namespace. Validate deployment identity, RLS/wrapper ACLs and
`ops/account-deletion/apple-readiness.sql` without exporting personal/token data.

Verify `customer-deletion-cleanup` cron/private `kick_customer_deletions` transport,
protected dispatch secret, HTTPS gateway routing and cleanup receipt recovery.
Only enable normal eligibility with `configure_customer_deletion('production',true,
'{}'::uuid[])` after identity/backups/code are verified. Independent HTTP flags
remain required. Verify live mail, capability, health, release commit/digest and
approved disposable account flow; do not substitute configuration success for
actual delivery or completion. Native upload/submission/public release each remain
separate, concrete owner decisions coordinated by the iOS chat.

## Stop and recovery

Stop new requests first (`CUSTOMER_ACCOUNT_DELETION_ENABLED=false`); keep cleanup,
Apple capability, dispatcher target and correct credentials/encryption on until
accepted work finishes. Inspect pending counts/age/leases and safe health metrics,
never contacts, codes, receipts or provider bodies in logs. Do not reset pending
jobs, erase credentials or mark acknowledgements complete to force a green result.

Do not downgrade the deletion Function while stored Apple envelopes/tasks require
its new contract. Compatible frontend rollback may retain the new cleanup backend.
Do not reverse SQL, restore a database over customer writes or imply anonymized
identity can be recovered by turning a switch off. Restore known compatible
artifacts/configuration only under actual-state reconciliation. Database disaster
recovery is separate from ordinary release rollback.
