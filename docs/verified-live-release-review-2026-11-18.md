# Verified CI reuse — prepared for Live review

18 November 2026 · Review only. No Live rollout or configuration change.

The first version is intentionally narrower than the pinned Test benchmark. For eligible frontend-only merges, it can avoid repeating the browser and database suites. The application job, dependency review, secret scan and packaging checks still run. Compilation of Functions and the exact release image smoke test and vulnerability scan remain in the release path.

## What is prepared

1. A same-repository PR targeting `main` runs the normal checks. The browser and database jobs take a non-secret fingerprint immediately before and after their checks. Only a successful run with unchanged inputs uploads a receipt. The evidence records the test-merge commit and tree, merge parents, run and attempt, and the input fingerprint. It is stored as a small GitHub Actions artifact with one-day retention.
2. On an actual `main` push, each candidate suite sets up the existing synthetic CI stack on its ephemeral runner. The gate checks the reviewed PR, exact final commit tree and parents, current workflow and attempt, successful required jobs and relevant steps, fresh receipt and artifact digest, and independently measured inputs. Those inputs include the hosted runner image version, CPU, kernel, installed package versions, tool versions, local service image IDs, checked-in locks and installed Playwright browser files. The test merge and the final merge may have distinct commit IDs, but their tree and parents must agree. Missing, conflicting, changed, expired or unrecognized evidence runs the existing suite.
3. The current production package job, release format, image digest pinning, protected credentials and attestation checks are unchanged. The release controller still verifies the package, runs the existing Supabase readiness gates, applies compatible backend changes and verifies their acknowledgement **before** asking Dokploy to deploy the frontend. No change to the controller, backend helper, rollback or Dokploy is part of this branch.

The first scope is ordinary additions or edits to frontend source and supported design assets. Changes to Functions, SQL, dependencies, workflow files, renamed or deleted files, tests, deployment configuration or other paths run the full suite. This is a narrower optimization than the 9m 42s validation saving measured in the Test pilot. Setup and application checks remain on the critical path, and runner drift can still trigger fallback, so the production saving is not yet measured.

## Review and activation

| Repository variable `BARBER_RELEASE_VALIDATION` | Result |
| --- | --- |
| Unset, `off`, or an unrecognized value | Existing full validation. This is the default. |
| `shadow-v1` | Evaluate the real evidence and log eligibility. Both full suites still run. |
| `verified-v1` | Reuse only an eligible suite. Each missing or mismatched receipt independently falls back to the full suite. |

Keep the switch off during source review and use the normal protected PR route. Before asking to enable the shortcut, run an approved shadow observation on a routine eligible release: inspect GitHub's actual artifact and merge receipts, confirm the runner match or concrete fallback reason, observe both suites still running, and record merge-to-package time. Require at least one real positive matching receipt for each suite before switching it on. Do not turn the flag on simply because the isolated Test timing looked good.

Then get a separate decision on switching to `verified-v1`. Roll back the shortcut by unsetting the variable or setting it to `off` for future runs; a running workflow can have captured the old value already. Nothing about the controller’s existing deployment rollback changes.

Local checks verify both YAML files, the unchanged package job, exact and stale evidence, mismatched commit/tree/parents and inputs, skipped or failed CI, altered or unsafe ZIP archives, and observe-only versus enforcement behavior. They do not certify a real main-branch evidence read or prove that runners in independent workflow runs will match; that is the purpose of the shadow observation. This change affects CI only and does not require an application or database deployment on hosted Test.

Related evidence: [paired Test validation benchmark](https://github.com/malabdullah/barberplusplus/actions/runs/44252894921) · [matching Test packaging proof](https://github.com/malabdullah/barberplusplus/actions/runs/44257301130) · [production runbook](deployment-runbook.md).
