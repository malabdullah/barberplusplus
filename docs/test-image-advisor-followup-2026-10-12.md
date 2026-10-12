# Test image and advisor follow-up — October 12, 2026

Status: local preparation only; no merge, image publication or deployment of
this follow-up has occurred. The live five-migration Test release is unchanged.

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
