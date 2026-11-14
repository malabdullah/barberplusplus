# Revised default-off setup proposal

LOCAL PREPARATION ONLY. The single diagnostic approval is completed and closed;
it authorizes none of this setup. Independent review and fresh owner approval
are required before access, key use, installation or runtime changes.

Actual diagnostic receipt:
`2d29e81b2c9fff12a4c590f8c5fee0f104dd9540e3f251dd75c444e6f3b97b02`.
Live Functions are healthy and their exact Compose model matches. The only failed
source predicate is missing explicit `SUPABASE_URL`; its effective runtime value
already matches the required internal address. Other three explicit pins match.
The cleanup credentials, three switches and optional backend are absent.

The narrow additive helper `ops/auth/apple_cleanup_inherited_pin.py` accepts
only that missing source pin. It validates the hash of actual original bytes,
all four current effective public bindings, reviewed image/running/healthy,
absence of the six new deletion field names, and exact running/Compose hashes.
All six field names must also be absent from the actual original source, even
if a newly introduced value would otherwise be safe (`false` or expected backend).
Source/runtime absence contradictions stop before any issue/entropy call.
The future approved runner must collect this fresh evidence on-server under the
existing exclusive backend lock, with all original four-container, private-path,
new-path, signing/login and source-hash guards. A historical safe receipt cannot
substitute for fresh evidence. The helper has no CLI, subprocess, signing or
entropy implementation; dependencies must be supplied explicitly after approval.

Only the derived in-memory candidate receives the one explicit pin. The unchanged
strict bootstrap.prepare validates that candidate before credential issuance or
entropy. The helper stages the final candidate together with **actual original
bytes**, preserving original formatting and missing source field in the rollback
file and beforeSha256. It never calls bootstrap.stage with normalized bytes as
the purported original. A present correct, wrong or empty pin all stop this narrow
path; other missing/wrong pins, flags, existing credentials, mismatch or stale
staging also stop. This is not a generalized environment normalization tool.

The replacement commands.json retains the original complete setup scope and
failure plan, and changes only the explicit pin exception, temporary public
cache (a new absent directory with ten public files), helper stage call, exact
seven-field staged diff, and actual-original rollback. Old public cache and all
old helper sources remain unchanged. The additive helper stays in the operator
cache; it is not a new recurring service or credential authority.

There is one final Functions replacement/recreate, as originally proposed.
No active pre-normalization, intermediate config write or extra restart is added.
The correct effective SUPABASE_URL stays identical. All three deletion switches
stay false. Other environment values, Auth/DB/Storage identities and starts,
original login helper/credentials and existing backup/release units remain
protected by the original guards. Recognized rollback restores the actual
original file and original effective runtime; unknown drift stops for review.

If approved later, access is fresh DB-only exact IP/32 TCP22 for at most one hour,
stop new work at 45 minutes, reserve 15 minutes to restore access. Existing SSH
keys and strict host checks remain. Restore original profile367995/rules and
remove only the temporary rule immediately afterward. No automatic TTL claim.

Excluded remain SQL/migrations, Functions-source/frontend release, dev/main push,
feature activation, customers, Apple/provider calls, emails/SMS/push, offline
archives/B2/backup reads/restores, app upload/submission/publication. Later genuine
post-install daily backup and separately approved exact recovery-file checks
remain gates. Synthetic local tests prove only transformation/guard/private
staging behavior, not live keys, Docker, systemd, backup recoverability or setup.
