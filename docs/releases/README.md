# Release records

Use template.md for the initial controlled cutover and separately planned
incompatible releases. Routine compatible main releases are recorded by the
controller's durable private journal and verified GitHub build manifest.

Records must bind the source commit, workflow run/attempt, frontend digest,
backend archive digest and ordered migration hashes. Record actual verification
and unresolved limitations. Keep credentials, production schema exports, customer
data and infrastructure inventories outside this public repository.
