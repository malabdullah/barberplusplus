# Release-Control Implementation — 2026-09-03

Implemented at: `2026-09-03T05:03:27Z`

Production state changed: **No**

## Implemented

- Staging installs Node `24.20.0` and the locked npm/Supabase CLI dependencies
  instead of relying on whatever CLI happens to be available on the runner.
- Staging and production migration pushes use `--skip-vault`, preventing schema
  delivery from implicitly updating environment secrets.
- Staging performs a dry run before applying its migrations.
- Production performs and retains a dry run before the final fresh-backup gate
  and before applying migrations.
- The accepted staging manifest binds the full commit, image digest, workflow
  run, acceptance time, latest migration, every migration file hash, and a
  deterministic migration-tree hash.
- Production verifies that manifest against the exact source tree, originating
  successful staging run, and GHCR digest before promotion.
- CI runs four deterministic release-manifest tests, including rejection of a
  changed migration, legacy migration name, and mismatched staging run.
- The release-record workflow no longer requires a post-acceptance commit. That
  previous sequence would change the commit/image identity it was attempting to
  record. Immutable values now come from the successful staging artifact and
  are attached to the approval request without modifying the accepted commit.

## Validation

| Check | Result |
| --- | --- |
| `npm run check` | PASS |
| Release-manifest tests | PASS — 4 tests |
| Workflow YAML parse | PASS |
| `git diff --check` | PASS |
| Current migration-set rejection | PASS — eight legacy filenames correctly prevent acceptance |

The normal frontend build still reports its existing large-chunk warning. Deno
also reports its existing ignored-build-script advisory; lint, type checks, and
Function tests pass.

## Supabase compatibility items added to the release gate

The current changelog contains self-hosted breaking changes relevant to this
release: the default API gateway moving from Kong to Envoy, the default database
image moving from PostgreSQL 15 to 17 without an in-place volume upgrade, Studio
and postgres-meta ownership changes, restrictions on the Realtime schema, and
the upcoming requirement for explicit Data API grants. The production and
staging component inventory must prove these are pinned and compatible; this
release must not combine a component upgrade with the database baseline or
frontend cutover.

## Remaining stop conditions

The authoritative baseline and restored-production rehearsal remain prerequisites
owned by the earlier database work. Until they supply timestamped active
migrations, `supabase/.baseline-ready`, `supabase/schema.expected.sql`, pgTAP and
schema-drift evidence, the staging workflow and accepted-manifest creation fail
closed. No tag, production workflow, observation clock, or cleanup is eligible.
