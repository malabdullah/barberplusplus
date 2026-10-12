# Test image and advisor follow-up — October 12, 2026

Status: local preparation only; no merge, image publication or deployment of
this follow-up has occurred. The live five-migration Test release is unchanged.

## Actual preparation evidence

- Repository check/build passed, with 34 Functions tests. The separate operations
  suite passed 26 checks, including silent/malformed/nonzero/finding rejection.
- Local Chromium: 13 journeys passed after supplying the actual loopback browser
  key. The first attempt had four setup failures because that key was absent;
  those failures are not passes. WebKit: eight responsive/language/theme checks
  passed. Final Linux Chromium/Firefox/WebKit CI remains required.
- A sealed-source AMD64 frontend at application preparation source `b2b79c4`
  passed health, release/runtime, CSP/cache/noindex, unprivileged execution and
  English/Arabic indicator checks, without network or published ports. Trivy
  0.74.0 / October 12 data reported zero matches at every severity and zero secret
  matches across 70 Alpine packages. This is not a complete application audit.
- Investigated local probe failures were an image-manifest/configuration identity
  assumption and archive/umask file-mode normalization. Strict configuration
  bytes and RootFS binding resolved the former; committed public 0644/0755 modes
  within an owner-only workspace resolved the latter. No live failure occurred.
- Native fresh nine-service rehearsal `barber-test-rebuild-1021889c1797be21`
  used validation source `221cd55` and the exact published 051acef Functions
  artifact. Six migrations / 94 pgTAP assertions, five synthetic logins, new
  Vault encryption, Storage, sink mail, Functions/Flow, Realtime update delivery
  and tenant denial passed. The CLI exited successfully with explicit structured
  empty results, and public DDL matched the fixture byte-for-byte. The rehearsal
  retained the currently deployed frontend; its result is separate from the
  patched frontend probe, not one conflated exact candidate acceptance.
- Advisor receipt SHA-256 is recorded privately along with complete evidence.
  Original container/freeze identities remained unchanged and only labelled
  disposable resources were removed. Lost-server restoration remains unverified.

These results are preparation, not approval of a published follow-up release.

## Narrow changes

Keep the reviewed Nginx base digest and unprivileged UID. Pin the supported
Alpine patches verified in signed v3.24 indexes: curl/libcurl 8.22.0-r0,
libpng 1.6.59-r0, nghttp2-libs 1.70.0-r0 and zlib 1.3.2-r1. Preserve the previous
expat, UUID, PCRE and TIFF pins. No application API, SQL, credentials, domains,
callback, integration or environment-policy change is included.

The pinned Supabase CLI distinguishes status `--output=json` from global
`--output-format=json`. The earlier rehearsal saved empty advisor stdout and
tested string absence. Its 94 concrete database assertions and functional
rebuild evidence remain, but the empty file does not prove zero warnings.
Require `--fail-on=warn`, explicit structured `results: []`, successful exit
and bounded valid JSON. Silence, malformed/missing results, any finding or
unsuccessful exit rejects readiness. Historical receipts remain unchanged.

## Remaining Functions findings

The published 051acef Functions image has 23 MEDIUM and eight LOW package
matches, zero HIGH/CRITICAL and no secret match. These are package matches,
not unique-advisory counts. The official newer compatible Debian 13 base at
`159783207c2cd44c2aa5715961d13c8612368ac9bd450f887e3f08fc8ea461e3`
retains the same counts under the same October 12 feed. A newer digest alone
does not justify changing the reviewed ABI/runtime. Keep the existing pin.

The [Debian fopen advisory](https://security-tracker.debian.org/tracker/CVE-2026-18374)
and [aligned-allocation advisory](https://security-tracker.debian.org/tracker/CVE-2026-95619)
identify unfixed stable-package issues and specific triggering conditions.
Their actual reachability and the other findings need exact-runtime assessment;
do not assume they are safe, mix unstable distribution libraries or suppress
scanner matches. The existing backend Test acceptance neither covers these new
findings nor grants production acceptance or a deadline extension.

## Gates

Validate local checks/build, the patched AMD64 frontend and all-severity scan;
rehearse the structured advisor gate in fresh labelled synthetic services.
Then record separate review and all five CI checks. Merge/build, signing and
live Test release approvals remain separate. Stateful rollout needs a fresh
encrypted Mac-verified checkpoint and operation lock. Never reset shared data
or downgrade SQL automatically. Test/iPhone acceptance and production backup,
compatibility, hosting and release controls remain separate requirements.
