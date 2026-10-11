# Solo-owner Test transition code review — October 11, 2026

Separate review pass of the transition patch relative to 6a6e0f4. This is an
agent code review under the approved solo-owner policy, not independent human
approval or authorization to merge/deploy.

Reviewed boundaries: unchanged runtime identifiers/origins, root/user-owned
state outside checkout, immutable candidate identities, strict browser runtime
parsing, shared atomic capture/maintenance lock, historical backup readers,
new v3 checkpoint binding, fixed-purpose controllers, observation-only monitor,
bounded maintenance suppression and labelled synthetic-only rebuild cleanup.

Review changes incorporated:

- Reject browser service keys, extra injected runtime code and cross-origin API
  configuration, even if a proposed configuration has a recorded hash.
- Require matching image/configuration/migration identity while frozen; mutations
  require an open state and shared operation reservation. Root access can bypass
  a procedural guard; this is explicitly documented rather than called a root
  security boundary.
- Keep v1/v2 validation intact. Dispatch v3 explicitly and reject corruption,
  unknown files, production identity and migration/configuration mismatch.
- Missing DB isolation observations are unknown. Maintenance never suppresses
  Access, isolation, origin drift or security; a window expires after 15 minutes.
- Deduplicate disk alerts by warning/failure band, rather than every percentage.
- Prevent historical pruning commands after the Test profile is installed.
- Native synthetic rebuild uses random fresh secrets/volumes and source SQL;
  startup respects Auth/Storage schema ownership. Archive membership and every
  source digest must match before extraction; Mac metadata is excluded.
- Retain failed operation journals until investigated; never claim a successful
  rebuild or independent restore on a partial functional pass.

Validation so far: complete repository check passed; 9 local E2E journeys
passed; current checkpoint/policy/historical negative tests passed. Local
Firefox cannot launch under macOS sandbox (plugin-container permission and
framebuffer errors); full three-engine acceptance must be established by Linux
CI. Native rebuild currently passed core checks but failed Realtime handshake;
bounded diagnostics and final CI remain required. No ready/GO claim.
