# Durable replay persistence — implementation, not deployment permission

October 8, 2026. This is a local library and synthetic Linux rehearsal. It is
**not installed in the live observer/broker**, does not make an authorization
decision and cannot deploy. Root policy and automation remain disabled.

## Contract

`scripts/staging-replay-ledger.mjs` extends the existing canonical v1 JSONL
reader with release lifecycle and durable filesystem operations. An explicitly
initialized, private 0700 directory contains only `ledger.jsonl` and
`checkpoint.json` (0600, single-link regular files owned by the configured
writer). Opening an existing transaction never initializes missing state.

An exclusive `in-progress` directory is held for the **whole transaction**, not
one append. History and the checkpoint are verified before each transition:

`observed → verified → authorized → executing → consumed`

Any nonterminal state may instead become terminal `failed`. The identity must
remain identical throughout the transaction. A second request may start only
after the previous request terminates. Repeated binding, request, artifact,
envelope, run ID, nonce or complete commit/image/migration tuple is refused.
First-attempt request IDs must belong to repository `1123713308`. Invalid dates,
noncanonical timestamps and backwards record times are refused.

Appends use `O_APPEND|O_NOFOLLOW`, a partial-write loop and `fsync`. The new
checkpoint is created exclusively, flushed, atomically renamed and followed by
a directory flush. A retained checkpoint detects truncation at a valid record
boundary. A partial write, stale/missing checkpoint, unexpected file, unfinished
transaction or uncertain I/O leaves the lock in place for operator review.
No timer expires it, no retry steals it, and no code automatically repairs,
truncates, rotates or resumes history. The 1 MiB limit fails closed.

The independent verifier and root broker must use **separate ownership and
separate directories**. The future root broker must not trust a service-writable
ledger as its authority. Root-controlled executable/configuration/ancestors and
host identity must be checked by the future installer and caller; the library
does not provide a privileged path-selection endpoint. Configured UID and root
path must never come from an untrusted release request.

`verified`, `authorized` and `executing` are stored lifecycle labels, not proof
that those checks occurred. A caller must perform the authenticated evidence,
trusted-clock, independent root approval and expiry checks before recording the
corresponding event or performing any side effect. Every library result remains
`authorizing: false`. The existing live observer is deliberately not connected
to this writer, and its earlier diagnostic log is not imported as authorization.

Hash chains/checkpoints are not a defense against a writer rewriting both files
or restoring a complete older directory. Root compromise is outside this
boundary. Independent root enforcement and off-VPS checkpoint/backup receipts
remain required before activation. No off-VPS anchoring or hardware power-loss
test is claimed here. Exceptions must be caught by the future service boundary
without logging supplied data or raw exception messages.

## Validation

- All 14 new tests passed on the Mac and natively as non-root `barber-admin` on
  `srv1207055`; a child really receives SIGKILL after its first durable record.
  Reopening then fails on the retained lock. A separate child process proves
  concurrent acquisition is refused.
- Tests also cover normal terminal reopen, every replay identity, invalid
  lifecycle transitions, changed identities, malformed dates, backwards time,
  forged but internally rehashed chains, checkpoint mismatch, partial data,
  missing/pending checkpoint, unsafe files/ownership and oversized state.
- Native public-module rehearsal directory:
  `/tmp/barber-ledger-rehearsal.dmfyjCmy/`. Only disposable test directories were
  removed by the tests; the three public source modules remain for audit.
- Native ledger module SHA-256:
  `b0c33baa72b6e0ac853577bc6eb86cca28d7c2d5074d0daf82b107df5941f6a7`.
- Native test module SHA-256:
  `34894f24e842b53ca5f48c60e51c104b86683112d30184e3427d9d80588b016c`.
- Unchanged wire-format verifier module SHA-256:
  `fc8fd63785a7605bd07d2065c7e996afadaa094acea1011a1c573db9e0dde980`.
- Full local `npm run check` passed after adding persistence. The subsequent
  release-binding fix has its own verifier regression run. All five local
  Playwright journeys passed against the retained loopback development database;
  no local reset was performed and no VPS browser acceptance is claimed.

The accompanying binding fix accepts GitHub REST artifact timestamps with
whole seconds as observed in real release evidence, while leaving signed
envelope timestamps strict and unchanged. Run-ID and nonce replays are now
rejected by the pure binder as well as by persistence. These synthetic binding
checks do not prove a fresh online release or authorize reuse of the expired
October 8 observation.

## Remaining integration

Review/install fixed root-owned callers, initialize independent histories,
anchor/backup the root checkpoint off-host, compose real evidence under the
held lock, and test failure/recovery with the fixed backup/migration/deployment
workers. A deployment identity still must receive neither sudo nor Docker.
The five-second broker request helper must not be used to run a long backup
synchronously. First-release recovery, image rollback and asynchronous job
status need their own reviewed fixed operations.

No running service, credentials, database, DNS, firewall or production resource
was changed by this work. It does not complete Env3 or the deployment system.
