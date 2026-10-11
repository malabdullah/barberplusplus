# Test transition evidence

`rebuild.json` is the sanitized native receipt read from
`/opt/barber-staging-closure-preparation/barber-test-rebuild-a00a44cd5445fc5b.json`.
The operator source archive was verified by exact membership and every file hash;
archive SHA-256 `52f4ee51cc6a1f057f757ac279686adc1575bffb135021f8d51ce9cc46467cfe`.
It proves a fresh synthetic rebuild with the existing release's exact images,
new secrets/volumes and native Realtime profile. It does not prove an independent
lost-server restore, a new application release or production readiness.

The later bounded protocol-readiness helper has separate unit evidence. Earlier
failed rehearsals and investigated journals remain private on the VPS; no
partial result was converted into this success receipt.

CI at 8defaf4 passed all five checks in run 38119419755, including the complete
Linux Chromium/Firefox/WebKit matrix. Local Chromium matrix passed; WebKit admin
and manager passed initially and agent/barber passed on a clean retest after
concurrent preview builds ended. Local Firefox could not launch its macOS
plugin-container/framebuffer; that failure remains a platform limitation.

The pinned Test notifier returned success after the explicit labelled test.
Recurring monitoring installation and scheduled/resume evidence are separate
gates; notification invocation alone is not monitoring acceptance.
