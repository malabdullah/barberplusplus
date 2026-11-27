# Barber++ full functional regression plan

Latest completed hosted Test run: [27 November 2026 closure and case matrix](runs/20261127T051710Z-all-roles/README.md). All 311 applicable variants passed. Nine were excluded.
Created: 26 November 2026. Invocation: explicit owner request only, using
`$full-regression-testing`. Do not add this full campaign to pushes, PRs,
scheduled jobs or ordinary fixes. Existing focused CI remains unchanged.

## Scope, version and safety

Test the main customer, barber, manager and admin website workflows and their
shared records. Agent and Super Admin behavior is included where it establishes
an access boundary; full agent, native iOS/Android, load, penetration and disaster
recovery campaigns are outside this plan. Native requests go through the Apps
Manager coordinator identified in AGENTS.md; do not contact platform agents
directly. Missing owner input follows the existing coordinator routing.

Use only hosted Test at https://barber-test.alabdullah-cs.workers.dev and backend
project `qvkucvcjmojjbphlzlks` (`barber-test`). Confirm both identities before any
mutation. No local website/Docker unless explicitly requested, no production
accounts/data, no real charges, and no messages outside controlled test recipients.
Do not expose the access-gate secret, tokens or passwords in reports. Obtain
missing credentials through the approved private coordination process.

Record frontend artifact/commit, backend/Functions identity, migration versions,
source and plan revision, time zone, feature flags and observed configuration.
Repeat identity checks at the end. Stop or segment evidence if another deployment
changes the tested release. The root checkout may differ from hosted Test: inspect
the matching source/worktree before interpreting results or running commands.

The initial inventory draws on repository routes, existing role/browser/database
tests and current release documentation. It is not a certification of present
coverage. Before a run, reconcile every feature with the actual target version:
production, Test and separate Test branches can contain different capabilities.
Add scenarios for newly enabled core features. Do not infer that a feature is
published merely because this plan lists it.

## Fixture contract and execution conventions

Create a run ID and exact fixture manifest. Use synthetic Customer A and B,
Manager A and B, Barber A1 and A2, Barber B1, an Admin and, only when needed, an
isolated privileged account. Shop A and Shop B belong to different managers.
Create services with known duration/price, working hours, a break, future slots,
an unavailable slot and bookings in relevant supported states. Capture existing
business rules (capacity, lead time, cancellation, rounding, subscriptions and
permissions) from requirements/configuration, not guesses. Use isolated browser
contexts for simultaneous roles, controlled inboxes, sandbox integrations and
disposable users for account deletion. Save existing preferences before editing.

For each row: establish fixtures, perform the listed actions, compare with the
expected outcome, record evidence, and verify persistence after reload where
applicable. `C` means critical; `S` means standard. Every applicable row is
required for FULL PASS; priority controls triage, not whether to skip it.

Default execution is hosted manual/hybrid, not claimed automation. Before a run,
map existing automated assertions to case IDs; automation may cover only part of
a row. Expand slash-separated variants and alternate journeys into separate
result rows. Resolve unclear expected behavior before execution. Version-based
absence/disabled flags can justify NOT APPLICABLE; missing access/tools is BLOCKED.

## Customer scenarios

| ID | Priority | Actions and prerequisites | Observable expected outcome |
|---|---|---|---|
| C01 | C | Register a fresh synthetic customer; verify via controlled inbox where required; sign out and sign in again. | One usable account, correct customer identity, verification restrictions enforced, session persists as designed. |
| C02 | C | Sign in with valid/invalid credentials; submit empty/invalid fields; retry after a failed attempt. | Valid user enters; invalid input fails clearly without authenticating or exposing another account. |
| C03 | S | Search/filter shops by supported city/governorate; open result and empty-result states. | Correct eligible shops and location labels; clear empty state; no stale results from the previous filter. |
| C04 | S | Open Shop A, inspect services, barber, duration, price and supported rating details. | Display agrees with fixture data and published status; hidden/unavailable records are handled according to policy. |
| C05 | C | Complete each supported booking entry journey (shop/service/barber selection) into a known free slot. | Correct shop/service/barber/customer/time/price; one confirmation and one persisted booking per submission. Inventory actual journey variants first. |
| C06 | C | Try a past time, break, closed period, unavailable barber and insufficient remaining service time. | Invalid slots are absent or rejected server-side; no invalid booking is saved. |
| C07 | C | Double-click confirm; reload after submission; retry after an uncertain response using run-owned data. | At most one accepted booking for the intended operation; UI reconciles actual outcome without misleading success. |
| C08 | C | Open own upcoming/history details; refresh and open a direct booking link. | Correct owner, status and details; no duplicate or missing record after navigation. |
| C09 | C | Reschedule an eligible booking to another valid slot, then attempt a forbidden/occupied slot. | Allowed change persists across roles; old/new capacity is correct; denied change leaves original booking intact. |
| C10 | C | Cancel eligible booking; repeat cancellation; try a state/time where policy disallows it. | Correct final state and slot release; repeat is safe; forbidden transition is rejected. |
| C11 | S | Add/remove favourite; navigate away, refresh and sign in again. | Correct customer-owned favourite state persists without affecting Customer B. |
| C12 | S | Submit/change rating for eligible completed booking and attempt ineligible/other-user booking. | Configured eligibility and one-record/update rules hold; display matches saved rating. Written reviews remain conditional. |
| C13 | C | Open own/other booking links and tamper with a booking/customer identifier via permitted Test API tools. | Private fields and mutations are denied for other users; intended public sharing exposes only approved data. |
| C14 | S | Edit own profile with valid/invalid data and refresh. | Supported changes persist; uniqueness/format rules and private-field restrictions hold. |

## Barber scenarios

| ID | Priority | Actions and prerequisites | Observable expected outcome |
|---|---|---|---|
| B01 | C | Sign in as Barber A1; navigate dashboard and direct manager/admin routes. | Correct barber workspace and identity; higher-role content/actions unavailable. |
| B02 | C | Open appointment list/calendar and filters, including empty day and booking details. | Correct assigned appointments, dates and status; no Shop B or unauthorized colleague records. |
| B03 | C | Observe Customer A creation/reschedule/cancellation from a separate session. | Persisted booking details agree across sessions; after supported refresh/update mechanism, lists and capacity agree. |
| B04 | C | Change booking state through allowed actions; attempt invalid/repeated transitions. | Only permitted state changes persist; completed/cancelled booking cannot silently re-enter an invalid state. |
| B05 | C | Request/change availability as supported; create overlap/break/invalid duration variants. | Correct validation and approval behavior; no forbidden slot becomes bookable. |
| B06 | S | View/edit permitted profile, service and My Chair settings where enabled. | Authorized values persist; locked fields stay protected; customer-facing information matches approved changes. |
| B07 | C | Attempt to read/update another shop's booking or availability by direct identifier. | Backend denies unauthorized access, even if UI controls are bypassed. |
| B08 | S | Open own work history/logs and notifications; mark one read if supported. | Correct recipient/actor records; no another-user unread count or private log data. |

## Manager scenarios

| ID | Priority | Actions and prerequisites | Observable expected outcome |
|---|---|---|---|
| M01 | C | Sign in as Manager A; open dashboard and direct Admin/Shop B routes. | Own permitted shops/workspace visible; restricted admin and other-manager resources denied. |
| M02 | C | Create disposable shop through supported onboarding; edit contact/location/hours; test missing fields. | Valid records persist with correct ownership; invalid values fail without partial public setup. |
| M03 | C | Publish/unpublish fixture shop or inspect blocker flow using a disposable shop. | Eligibility enforced with actionable explanation; public discovery reflects intended status; no unrelated shop changes. |
| M04 | C | Add/invite supported barber type; accept via isolated fixture; test duplicate/expired invite. | Correct shop membership/role/capacity; duplicate or invalid invitation cannot grant unintended access. |
| M05 | C | Add/edit/archive service and supported package; inspect customer booking choices. | Price, duration and visibility match policy; historical booking data remains valid. |
| M06 | C | Set hours/breaks/availability, approve/reject request and inspect customer slots. | Approval ownership enforced; accepted schedule affects correct barber/date; rejected request does not change bookability. |
| M07 | C | Create/manage supported booking; filter by barber/date/status; reschedule/cancel/update allowed states. | Correct ownership, totals, availability and cross-role visibility; invalid transitions rejected. |
| M08 | S | Open reports/finances with known fixture totals and date filters, including empty range. | Figures reconcile to included fixture bookings and configured calculations; shop/date scope correct. |
| M09 | S | Export supported report and inspect headers, rows, totals and Arabic text. | File opens, matches selected scope, contains no unauthorized shop/customer data and handles text safely. |
| M10 | C | Inspect subscription plan/capacity; attempt permitted and over-capacity barber additions. | Current entitlement enforced server-side; failure does not leave unintended memberships or charges. |
| M11 | C | Inspect settlements/reconciliation with known fixture records; repeat supported confirmation action. | Balances/status follow approved rules, no duplicate financial effect and no cross-shop access. |
| M12 | S | Edit supported shop/account preferences, refresh and sign in again. | Correct values persist and apply only to intended account/shop. |

## Admin scenarios

| ID | Priority | Actions and prerequisites | Observable expected outcome |
|---|---|---|---|
| A01 | C | Sign in as Admin; inspect dashboard and direct privileged administration routes. | Correct admin scope; Super Admin-only actions remain denied to ordinary Admin. |
| A02 | S | Search/filter/list managers, barbers, branches and users; inspect details and empty results. | Authorized data, counts and paging agree with fixtures; no misleading empty/error states. |
| A03 | C | Execute one permitted user/status change on disposable account; attempt forbidden role escalation. | Approved change persists and is auditable; escalation rejected by backend. |
| A04 | C | Create/revoke disposable admin invitation if permitted; try replay/expiry/wrong recipient. | Only eligible recipient gains permitted role; invalid/replayed invitations cannot grant access. |
| A05 | S | After ordinary Admin MFA, wait for the dashboard sidebar and the four loaded analytics metrics. Compare Today with the hosted booking response, then request an empty day in the isolated browser and inspect the booking-status chart. | Totals/date scope and empty states agree with recorded inclusion rules. |
| A06 | C | Change reversible test-only location/global configuration within granted scope; restore it. | Validation and role limits enforced; affected UI updates; original configuration restored and verified. |
| A07 | S | Inspect activity/security/audit records from run-owned changes. | Correct actor, action and timestamps; no password/token leakage or unauthorized log mutation. |
| A08 | C | Attempt protected configuration/privilege changes with customer, barber, manager and ordinary Admin sessions. | Exact role boundary enforced server-side; no hidden-control bypass or privilege escalation. |

## Shared and complete-journey scenarios

| ID | Priority | Actions and prerequisites | Observable expected outcome |
|---|---|---|---|
| X01 | C | Manager sets service/schedule → Customer books → Barber/Manager inspect → Customer reschedules → permitted staff completes. | One consistent lifecycle across roles, correct capacity/status/history and applicable financial/report effects. |
| X02 | C | Repeat lifecycle with cancellation; inspect slot, calendars, notifications and reports. | Final cancellation agrees everywhere; only configured recipients/effects occur. |
| X03 | C | Two isolated customers submit concurrently for a slot with remaining capacity one. | Only allowed capacity accepted; loser sees clear result; no orphan or duplicate records. |
| X04 | C | Start a reschedule while another session cancels/changes availability; retry with stale page. | Business invariants hold; stale client cannot overwrite a newer invalid state or overbook. |
| X05 | C | Sign out; visit protected route; expire/revoke isolated session; refresh/back navigation. | Protected content/API inaccessible without a valid session; no stale account data appears after switching users. |
| X06 | C | Attempt other-shop/customer reads and updates for bookings, profiles, services, availability and financial records. | Each table/API respects actual role/tenant ownership, including direct requests and forbidden updates. Expand by resource and role. |
| X07 | S | Run each role's main journey in English LTR and Arabic RTL, light/dark where supported. | Readable labels, correct direction, usable controls, correct customer shop terminology and admin branch terminology. |
| X08 | S | Run role-critical pages on supported mobile/desktop viewports; use keyboard navigation and field errors. | No blocked controls/overlap, visible focus, usable labels/errors and no essential horizontal clipping. Record exact browsers/sizes. |
| X09 | C | Interrupt Test network during a fixture save; restore it and inspect persisted state; simulate safe integration error where available. | No false confirmation, uncontrolled retry or duplicates; error is understandable and persisted state recoverable. |
| X10 | C | Test near-midnight/date-boundary and closing-time appointments using recorded service/UTC/local time rules. | Date, duration, availability and filters agree across roles; no off-by-one-day booking. |
| X11 | S | Open supported deep links, refresh role pages and use browser back/forward; inspect console/network failures. | Correct routing, authorization and recoverable state; no essential asset/API failures hidden by a populated shell. |

## Conditional feature inventory

At preflight record enabled, disabled or absent for each row against the exact
target. Add its variants to the run report when enabled. Disabled/absent is NOT
APPLICABLE with evidence, not PASS. Live provider interaction that cannot safely
run on Test is BLOCKED; synthetic identities do not prove real OAuth works.

| ID | Priority | Enabled-feature actions | Observable expected outcome |
|---|---|---|---|
| O01 | C | Customer/staff Apple/Google login and invitation registration; cancel/deny/retry callback. | Correct account linking, role and redirect; no duplicate account/escalation; real provider coverage separately evidenced. |
| O02 | C | Reset/change password, verify email/phone with controlled destinations; test invalid/expired/reused proof. | Only rightful account changes; expired/reused proof rejected and session policy applied. |
| O03 | C | Delete disposable customer through documented confirmation/reauthentication; retry and inspect permitted retained history. | Access revoked, intended deletion/anonymization and retention rules observed, shared records intact. Never use owner account. |
| O04 | C | Sandbox checkout success/failure/cancel, repeated callback and interrupted return for each enabled gateway. | Correct booking/payment status and amount, no duplicate charge/credit; no real gateway credentials or charges. |
| O05 | C | Wallet top-up/spend/split/refund, insufficient funds and concurrent/replayed operations. | Ledger and balance reconcile; no unauthorized negative balance, duplicate credit or cross-user access. |
| O06 | C | Subscription discounts/complimentary access/extra capacity and invoice download. | Approved eligibility, totals, entitlement and PDF match authoritative records; retries do not duplicate benefits. |
| O07 | C | Completion payment-method selection and overdue reminders; reschedule/cancel before reminder. | Only allowed method/status transitions; reminders reach controlled eligible staff once according to policy and stale reminders stop. |
| O08 | C | Online/pay-at-shop/both and manual approval booking modes. | Choices match shop policy; state/capacity/payment/approval transitions remain consistent across customer and staff. |
| O09 | S | Public shared booking URL and unauthorized/private URL variants. | Intended public availability shown without private booking/customer fields or unauthorized mutation. |
| O10 | C | In-app/email/push/communications templates, read/unread state and scheduled delivery using controlled recipients. | Correct audience and recipient scope; no duplicate/unintended external send. Native delivery/tap acceptance requires separate coordinator-managed scope. |
| O11 | S | Upload/replace permitted image and reject unsupported/oversized file. | Correct object ownership, validation, display and cleanup; no another-user overwrite or private-file exposure. |
| O12 | C | Supported manager transfer, managed-barber or account permission lifecycle on disposable fixtures. | Correct ownership and access before/after; removed rights cease, unrelated memberships and bookings remain intact. |

## Existing automation discovery (not a coverage claim)

- `tests/e2e/public.spec.js`: landing-page smoke; not all customer functionality.
- `tests/e2e/roles.spec.js`: selected role routing and tenant boundaries; not all role journeys.
- `supabase/tests/001_baseline_security.sql`: inspect assertions for applicable database boundaries.
- `src/**/*.test.js` / `src/**/*.test.jsx`, Functions tests and release checks:
  inspect matching target source and map relevant assertions; newer worktrees may
  contain substantially more tests than this checkout.
- Inspect `package.json`, Playwright configuration and `.github/workflows/ci.yml`
  before execution. Never run a command that boots a forbidden local runtime or
  targets the wrong database. Existing CI results supplement hosted observation.

Each run records method and exact file/assertion mapping where verified. Creating
this plan does not add executable tests or a GitHub manual-run workflow.

## Reporting, cleanup and acceptance

Store a redacted report at `docs/testing/runs/<timestamp>-<run-id>.md`; start all
applicable variants NOT RUN. Record case ID, priority, role, variant, status,
observed outcome, timestamp, evidence path/link and defect reference. Include
frontend/backend identities before/after, supported variants, flags, fixtures and
cleanup manifest. No passwords, customer records, raw cookies or tokens in Git.
Keep sensitive evidence private and reference it without exposing contents.

Allowed results: PASS, FAIL, BLOCKED, NOT RUN, NOT APPLICABLE. Keep original
failures and label retries. Count every expanded variant and all exclusions; do
not omit failed or blocked rows to improve a pass percentage. Record severity,
expected/actual behavior, reproduction and affected version for each defect.

Delete only exact run-owned fixture records in dependency order; restore saved
preferences/configuration and verify no pending jobs, test recipients, sessions
or orphaned records remain. Never reset a shared database. Preserve accounts or
fixtures owned by others. Record any incomplete cleanup as a blocker.

FULL PASS requires every applicable required scenario/variant passed on the
stated version and verified cleanup, with no required blocked/unrun cases.
Otherwise report FAIL or INCOMPLETE with counts by role, defects and coverage
gaps. A pass is a recommendation within scope, not production release approval
or proof of every possible case. Fixes, full reruns, production release, native
campaigns and backup restoration drills require their own explicit scope.
