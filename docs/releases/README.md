# Release records

Use template.md for the initial controlled cutover and separately planned
incompatible releases. Routine compatible main releases are recorded by the
controller's durable private journal and verified GitHub build manifest.

Records must bind the source commit, workflow run/attempt, frontend digest,
backend archive digest and ordered migration hashes. Record actual verification
and unresolved limitations. Keep credentials, production schema exports, customer
data and infrastructure inventories outside this public repository.

## Recent website releases

- [27 November · Admin location audit history](admin-location-audit-2026-11-27.md)
- [26 November · Booking city picker](city-picker-2026-11-26.md)
