# Production owner policy and off-site backup preparation

Status: **NO-GO for production release**. This record contains policy and a
proposed implementation design, not recovery proof or deployment approval.
Production data, configuration, credentials and inspection receipts stay private.

## Decisions and authority

On October 12, 2026, the owner explicitly approved:

- PR #11 merge and image construction at its reviewed exact head, including
  cancellation of the superseded waiting signing run. This is not deployment.
- Production approval by the owner alone, with no second reviewer. This replaces
  the earlier independent production reviewer requirement, not the other gates.
- Selecting an off-site backup provider. Selection does not approve purchases,
  billing, retention locks, credential installation or production uploads.

The `production` GitHub environment has been created and verified:

- Environment ID `24060783658`.
- Sole required reviewer `malabdullah` (ID `19295903`), self-review permitted.
- Custom policy ID `62761545`: type `tag`, pattern `v*`; no allowed branches.
- No deployment secrets; no pending production runs or newly created tags.

Main's PR requirement, five app-bound checks, strict up-to-date checks, admin
enforcement, conversation resolution and blocked force pushes/deletions remain.
A separate review is still recorded but is not independent human review. The
owner must explicitly approve the chosen semantic version, accepted image
digests, migrations/configuration and the protected production job.

The tag-ref filter above is not a tag-protection ruleset. Repository tag creation,
update and deletion protections must be established and verified before release.
The legacy production workflow still expects obsolete accepted-release evidence
and a deployment executor not verified on this infrastructure. Do not populate
its secrets or push a release tag merely because the environment now exists.

## Provider decision

Recommend **Backblaze B2**, S3-compatible private object storage, as the off-site
production destination. It is outside both the hosting provider and the DNS/
access provider's account, supports Object Lock and avoids a capacity commitment.
Cloudflare R2 is an alternative with no Internet egress charge, but concentrates
backup ownership and public-routing/access administration in the same account.
The provider recommendation is an architecture choice, not demonstrated tool
compatibility or a guarantee of availability.

Pricing checked October 12: B2 is $6.95/TB per 30 days, with the first 10 GB
free and free egress up to three times average monthly stored data; excess egress
is $0.01/GB. At 100 GB of **billed** storage, storage is approximately $0.70/month.
Retained base backups, WAL, file versions and recovery images all count. Charges,
taxes and account eligibility must be confirmed before enabling billing.
A proposed $5/month alert is a warning, not a hard spending cap; do not interrupt
healthy backups automatically when an alert fires.

Sources:

- [B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- [B2 Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock)
- [B2 regions](https://www.backblaze.com/docs/cloud-storage-data-regions)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [pgBackRest S3 repositories](https://pgbackrest.org/user-guide.html)

Before account setup, obtain pay-as-you-go and region approval. Proposed region:
EU Central; selection is made during B2 signup and cannot be changed in that
account. Confirm applicable data-residency requirements before customer-data
uploads. Do not claim that encryption establishes regulatory compliance.
The owner creates/signs into the account, enables MFA, handles payment and saves
recovery credentials privately. Never request passwords or API keys in chat.

## Recovery design to implement and rehearse

Keep the production 15-minute recovery-point and two-hour recovery-time targets.
They are not met merely by selecting B2, uploading a logical dump or setting up
a daily timer. No target is marked passed without measured restore evidence.

1. Inventory exact production images, PostgreSQL extension/build compatibility,
   configuration, database and file volumes privately. Pin reviewed recovery
   tools. Test B2 S3 upload/download, integrity, encrypted repository operations,
   expiration and restore behavior on synthetic fixtures first. pgBackRest
   supports S3-compatible repositories generally; this exact B2/tool combination
   still requires testing. Do not transplant a Test database binary into production.
2. Propose a separately approved production maintenance operation for physical
   database backup and continuous WAL archiving. Enabling archive mode can require
   a database restart. Bound the window, preserve current configuration/services,
   verify restart/rollback and never change database major version in this release.
3. Capture daily base backups plus continuously archived WAL. Propose a maximum
   five-minute WAL switch interval and independent recovery-point checks at least
   every five minutes, then prove actual lag stays within fifteen minutes. A
   configured archive command or a healthy database alone is not archival evidence.
4. Back up Storage bytes, metadata and changes independently, retaining deletion
   versions. Rehearse base plus bounded incremental captures at most fifteen
   minutes apart; bind database and file recovery points and test transaction/file
   consistency. Preserve ACLs, xattrs and numeric ownership. Never derive file
   recovery success from PostgreSQL metadata alone.
5. Capture necessary Auth/JWT, Vault/root-key material, database configuration,
   Functions, routing and other recovery configuration into separately encrypted
   exports. Keep daily data archives separate from once-per-digest image archives.
   Recover exact image/tool archives without relying on the original VPS cache.
6. Use new production-only backup credentials and encryption material. Repository
   encryption credentials needed for unattended capture stay in a restricted
   production secret store; their independent recovery copy stays in the owner's
   password manager. Separately encrypted configuration exports can use an
   asymmetric recipient whose private key is not on the uploader. Never reuse
   Test recovery, Auth/JWT, Vault or integration credentials.
7. Use private buckets and least-privilege, bucket-restricted operational keys;
   separate recovery and retention administration. Test the permissions actually
   needed by the selected tools, including repository metadata reads/updates.
   No master account key on the VPS, no public bucket and no secrets in CI logs.
8. Retain 30 daily and 12 monthly recovery points and their required WAL/file
   dependencies. Measure compressed size and WAL growth before authorizing a
   budget. No automatic pruning until dependency and last-good refusal tests pass.
9. Rehearse immutability on a separate append-only recovery-export prefix or
   bucket. Do **not** apply default Object Lock blindly to mutable pgBackRest
   metadata: it can break repository updates and expiration. Confirm every
   protected recovery point includes its base/WAL/files/config dependencies.
   B2 enabling Object Lock cannot be disabled; compliance retention cannot be
   shortened. Exact retention/mode needs explicit approval before enabling it.
10. Restore into a separately approved isolated recovery runtime, with no access
    to Test, customer-facing routes or real outbound integrations. Do not copy
    production data into the synthetic Test environment. A drill on the original
    source server/cache does not establish independent lost-server recovery.
    Runtime capacity, region, credentials and any rental cost need approval.
11. Verify PostgreSQL recovery timestamp, schema/history, Auth, new-session
    authorization, Vault decryption, Storage bytes/metadata, Functions and Realtime
    using approved non-destructive probes. Record measured recovery-point loss
    and total time; retain private logs and publish only sanitized conclusions.
12. Install independent always-on backup monitoring and owner alerts. Unknown or
    stale observations fail readiness. The production readiness endpoint must
    enforce the existing freshness/lag/off-host/restore schema; a Mac asleep or
    offline cannot be the sole production recovery monitor.

## Remaining release sequence

1. Finish exact new-image construction, signature verification, all-severity
   security dispositions and native synthetic regression testing.
2. Obtain a fresh Test checkpoint and exact Test deployment approval; apply only
   reviewed compatible migrations without resetting data. Complete live QA,
   owner iPhone checks and exact release acceptance. Existing bounded Test risk
   does not apply to production or newly scanned images.
3. Implement and prove the off-site production recovery design above. Obtain
   separate production infrastructure/maintenance approvals before mutation.
4. Reconcile production migration history using read-only schema evidence and an
   approved rehearsal. Never replay a baseline over a populated database or mark
   migrations applied solely because object names look similar. Authorization
   claim changes require a tested session-refresh plan.
5. Assess exact production components against current upstream changes and
   vulnerability data. Any upgrade is separately reviewed, backed up and rehearsed;
   production risk requires its own disposition, not a Test exception extension.
6. Approve frontend hosting, domain, TLS/callbacks and runtime configuration. Adapt
   the promotion protocol to signed **final Test acceptance** for both exact
   frontend and Functions images; a non-deploying request is not acceptance.
7. Configure protected tags/executor/monitoring without granting public PR jobs
   credentials or placing a general-purpose runner on a production server.
8. Fill the chosen version's record only when preparation/compatibility actually
   pass; obtain exact tag/digest/migration approval, then protected-job approval.
   Run non-destructive production checks and the required observation window.

No production version is inferred. No image is rebuilt for production promotion.
Application rollback uses the previous approved digest/configuration; database
remediation is a reviewed forward fix or explicitly approved recovery, never an
automatic migration downgrade. Policy setup and healthy Test monitoring are not
production readiness or permission to publish.
