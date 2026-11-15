# Proposed configuration-binding diagnostic

Preparation only. No production command or access is authorized by this packet.
The prior attempt's final safe receipt is
`f29469ca625889702a59ba74014e4842d618b09245829bd6a0093084fc163260`.

The stopped assertion groups four explicit override pins, two sensitive field
names being absent, three flags absent or exactly the string `false`, and an
optional backend binding absent or exact. It does not identify the failed member.
Earlier effective-runtime matches do not prove explicit override entries exist.

After independent review and separate owner approval, the proposed script would
run once through stdin on the database VPS only, as root, without arguments. It
opens the existing empty mode0600 backend lock read-only, takes a nonblocking
shared lock, and reads the existing root-private override JSON in VPS memory.
No signing key or login configuration is opened. No lock/file is created or
modified. It returns named presence/match/interpolation booleans for only the
reviewed fields; sensitive pair/encryption fields report name presence only.

It inspects only `supabase-edge-functions`, twice for snapshot consistency.
Docker's template projects the reviewed fields to fixed MATCH/OTHER/presence
markers before stdout. IDs, start time, image and Compose hash are compared
in memory; only image/running/healthy/hash-match booleans leave the process.
No generic container environment or rendered Compose configuration is emitted.
One `docker compose ... config --hash functions` computes the effective model
hash using the existing Compose files and `.env` in VPS memory. It neither starts
nor changes a container. Standard error and exception text are never exported.

A missing explicit pin plus matching runtime pin and matching Compose hash may
indicate inheritance. It is not automatically accepted or repaired. Mismatches,
credential-name presence or enabled flags require a separately reviewed next
step. Output always requires review; no automatic setup, normalization or retry.

Excluded: P8/JWT access or signing, entropy, SQL, Auth/Storage/customer inspection,
provider calls, backup/archive reads, installation, units/timers, credential
generation, config writes, restarts, frontend/dev/main changes and feature enablement.
Future access, if approved, must be time-bounded DB-only and restored afterward.

Local verification uses synthetic documents, mocked command outputs and
disposable temporary files only. It does not prove real Docker template/Compose
execution, server metadata, live configuration, cryptography or Linux systemd.
The fixed CLI guard is tested without running the diagnostic on this Mac.
