# Barber++ Product Requirements Document

| Document field | Value |
|---|---|
| Last reconciled | 26 November 2026, Asia/Kuwait |
| Scope | Website product requirements, environment status and shared backend boundaries |
| Production evidence baseline | `adb04de12851e90d87d703ba6021e0d3850c9091`, verified by the Website release record on 26 November |
| Production workflow | [45755911315](https://github.com/malabdullah/barberplusplus/actions/runs/45755911315), successful attempt 2 |
| Hosted Test | https://barber-test.alabdullah-cs.workers.dev; Supabase `qvkucvcjmojjbphlzlks` |
| Working rules | [AGENTS.md](AGENTS.md) |
| New maintainer / agent | [Handoff](docs/handoff.md), [state snapshot](docs/handoff-state.md), [architecture](docs/architecture.md), [documentation index](docs/README.md) |
| Full regression plan | [docs/testing/full-regression.md](docs/testing/full-regression.md), explicit request only |

This replaces the January 2026 inventory, whose WhatsApp architecture, routes,
role model and feature list no longer described the current product. Earlier
versions remain in Git history. This is a dated reconciliation of existing code,
feature documents and release evidence, not a new deployment or test result.

## 1. Product and roles

Barber++ connects customers with shops and barbers and supports appointment,
team, service, availability, operational and financial management. The website
supports English/Arabic, LTR/RTL, responsive layouts and light/dark themes.
Use **shop / صالون** in customer and other non-admin interfaces; **branch / فرع**
is reserved for admin wording. Existing database/API identifiers are unchanged.

| Role | Main responsibilities and boundaries |
|---|---|
| Customer/guest | Discover shops, choose services and appointments; signed-in customers manage their own account, favourites, bookings and eligible ratings. Guest contact matching does not grant private account history. |
| Manager | Manage currently assigned shops, team, services, availability, appointments, reports and finances; access billing according to business/billing ownership. |
| Barber | View assigned appointments, permitted profile/services and availability, personal performance and work history. A managed barber profile has no independent login. |
| Admin | Platform oversight, permitted user/configuration management, audit, settlements and subscriptions; protected actions require current authorization/MFA. |
| Super Admin | Additional administrator-management authority; ordinary Admin is not implicitly equivalent. |
| Agent | Existing staff-assisted booking/customer workflows in the agent workspace; retired WhatsApp screens and messaging are not restored by this role. |

One Auth account may have supported work and customer contexts. Authorization
must resolve the active permitted context and current ownership; a shared email,
phone or client-supplied role never grants access to another person's records.

## 2. Status definitions and evidence rules

- **Production:** recorded as deployed and verified on the production baseline,
  including earlier capabilities retained by that release. Runtime flags and
  permissions still determine who can use a feature.
- **Test-only:** implemented or piloted on isolated Test branches/configuration;
  not authorized as a production feature. Different Test branches can differ.
- **Planned/deferred:** not part of the currently approved production product,
  even where prototypes or retained Test schema exist.
- **Retired:** no longer an active product capability; historical data or enum
  values can remain for compatibility.

Preparation documents are historical phase records and sometimes still say
"pending" or "Test only" after a later release. The dated status below uses the
later Website release verification. Source on main and an approval alone are not
proof of deployment. The baseline is a historical observation, not a fresh live
health check performed while editing this document.

### 2.1 Production feature inventory

| Area | Recorded production capabilities |
|---|---|
| Discovery and booking | Three supported booking entry journeys, multi-city selection, shop/barber/service choice, availability, explicit confirmation and booking receipts. |
| Customer accounts | Email/password and configured social sign-in, canonical profile/contact, owned booking history, rebooking, rescheduling, cancellation, favourites and separate shop/barber star ratings. |
| Customer safety | Account sessions/activity/support tools, purpose-bound verification and recovery, supported account deletion and ownership isolation. Deletion eligibility and retained operational history follow the dedicated contract. |
| Sharing | Public booking/share URLs exposing the intended public booking experience rather than private customer records. |
| Shop/team management | Shop setup/publication, schedules, invitations, account-backed and managed barbers, My Chair, availability requests/approvals, services and packages. |
| Reporting | Operational reports and barber personal performance; manager finances with manual receipts/refunds/expenses/corrections; authorized Excel exports. |
| Settlements | Separate platform-to-shop collection/commission/reconciliation ledger and manager visibility. Actual bank transfers occur outside Barber++. |
| Subscriptions | Billing screens, pricing, capacity/access enforcement, renewal preferences, dated complimentary/manual access and discount-code administration; live gateway collection is postponed. |
| Administration | Distinct Admin/Super Admin controls, user and account tools, location/configuration management, analytics, audit/security records and role/MFA boundaries. |
| Notifications | Recipient-scoped website notifications and supported booking infrastructure. Apps Manager confirmed on 26 November that general Android Live booking/announcement delivery is enabled for eligible opted-in customers; one real Compact build 15 announcement/tap opened Favourites and original preferences were restored. This is not all-device/full-regression proof or Play publication approval. |
| 26 November additions | Completion payment-method selection with atomic receipt handling; unchanged confirmed-booking staff reminder 24 hours after appointment end; clearer publication blockers; recipient-scoped unread queries; managed-barber wizard action/return; Apple/Google signup for new invited barbers; branded standalone subscription invoice PDFs. |

The Website release completion record confirms main `adb04de`, actual frontend
image identity, three reviewed migrations (168 to 171 ledger entries), healthy
production service checks and unchanged existing Function source/environment.
These receipts support the status above; this documentation update reruns none
of those checks. See [the release scope](docs/releases/independent-2026-11-26.md)
and the linked completed workflow. Real Apple/Google prompts were not rerun in
that release; synthetic provider acceptance is not end-to-end provider evidence.

### 2.2 Test-only inventory

| Feature | Test scope and production boundary |
|---|---|
| B-Wallet | Customer balances, top-ups, wallet/split payments and related refunds; retained in isolated Test pilots. Wallet tables/Functions were excluded from the 26 November production release. |
| UPayments / MyFatoorah | Sandbox subscription, extra-barber-capacity and booking payments, callback/refund experiments. No live payment gateway is enabled by this PRD. |
| Shop payment choices | Pay at shop, online or both, including associated manual-approval payment journeys; remains part of payment pilots. Do not confuse this with released staff completion-method recording. |
| Design previews | Synthetic `/design/*` subscription/billing previews are Test-only; they are not evidence of a real charge or entitlement. |
| Native Test wallet scope | iOS Test 61/62 wallet work is separate from the Website pilot and retained local-only deltas require platform-owner reconciliation/approved transfer. Staged iOS 1.2.0 (34) is local/unuploaded and excludes wallet; none of this grants Live publication. See the native handoff through Apps Manager. |
| Additional retained prototypes | Some review/report/provider experiments remain on isolated Test branches. Inventory the exact target before a run; retained schema alone is not a shipped feature. |

The recorded 26 November release restored the prior hosted Test deployment after
candidate checks, preserving payment pilots. Do not assume main matches the
currently selected Test frontend or database overlay. Inspect runtime identity,
flags and migrations before testing or promoting any Test work.

### 2.3 Planned, deferred and held work

| Item | Boundary |
|---|---|
| Optional private written visit reviews | Future release; existing production numeric ratings remain. Retained Test work must be reconciled and reviewed before exposure. |
| Help Center and Feature Requests | Separately deferred; Contact Support does not implement these systems. |
| Live online payment launch | Requires separate acceptance, credentials/configuration, reconciliation and production authorization. Sandbox success is not live availability. |
| Android public publishing | Apps Manager reports Play 1.2.0 (15) production submission is in review following separate owner approval. Managed publishing is ON; public publication requires Google approval and a separate publish action. General Live notification delivery was separately enabled and verified on 26 November; backend activation and a controlled device test do not authorize store publication. |
| Native customer/staff delivery | Separate coordinator-managed assignments and platform acceptance. This website PRD does not claim no native implementation exists, nor certify any store release. Obtain current platform status through Apps Manager. |
| Broader finance/accounting scope | Automatic bank transfers, payroll/tax filing, inventory and complete accounting are outside the recorded manual-finance/settlement scope. |

See [private written reviews](docs/future-releases/private-written-reviews.md).
Admin announcement transports and audience activation have separate approvals;
a present Communications route is not permission to send to customers or enable
all devices. Follow current coordinator/owner scope for that subsystem.

### 2.4 Retired functionality

WhatsApp AI booking, messaging workers, conversation screens and related active
integration settings are retired. Preserve historical customer/message records,
applied migrations and compatible actor values. A retained `whatsapp_agent`
identifier displayed as Agent does not enable messaging. Do not recreate the
old Sulaiman/Anthropic/Meta architecture from the previous PRD.
See [WhatsApp retirement](docs/whatsapp-retirement.md).

## 3. Customer functional requirements

1. Discovery must show currently eligible shops, barbers, services and locations.
   Favourites must revalidate moved/inactive targets before booking.
2. Supported booking entry journeys converge on server-validated availability,
   duration, price and explicit customer confirmation. Signing in never confirms
   an appointment automatically. Concurrent/retried requests must preserve capacity
   and prevent duplicate accepted operations.
3. Guest and signed-in checkout preserve permitted selections through supported
   authentication returns. A guest booking is not private account ownership;
   saving it requires the documented short-lived receipt and canonical identity
   checks. Phone equality alone must not import someone else's history.
4. Account booking lists, rescheduling, cancellation, rebooking and ratings enforce
   live ownership and eligibility. Completed/cancelled and historical records
   retain the approved behavior when catalogs or account details change.
5. Profile, contact, password, email/session and deletion changes require the
   documented proofs. Account deletion must preserve mandated business history,
   expose pending cleanup honestly and not delete a linked work account through
   a customer-only action.
6. Numeric shop/barber ratings remain distinct from optional private text reviews.

Main routes include `/book`, `/booking/share`, `/customer/sign-in`,
`/customer/sign-up`, recovery/callback routes, `/customer/account`,
`/customer/favourites`, `/customer/delete-account`, `/customer/sessions`,
`/customer/activity`, `/privacy` and `/support`. Actual mounting depends on the
runtime configuration; [src/App.jsx](src/App.jsx) is the route inventory.

Contracts: [checkout](docs/customer-booking-checkout.md),
[favourites](docs/customer-favourites.md),
[canonical profile](docs/canonical-customer-profile.md),
[phone verification](docs/customer-phone-verification.md),
[account deletion](docs/customer-account-deletion-release.md),
[account tools](docs/account-tools-test.md). Their original phase labels do not
replace the later production status table above.

## 4. Shop, barber and staff requirements

- Managers manage only currently authorized shops, team, services, packages,
  schedules and bookings. Private records and actions must be protected in the
  backend as well as hidden/disabled in the UI.
- Setup supports invitation, a managed barber without credentials, and an owner's
  My Chair where permitted. Managed creation must stay attached to the intended
  wizard shop and return correctly. Invitations enforce recipient identity,
  expiry and single-use semantics; social callbacks cannot attach the wrong user.
- Availability requests/approval and direct managed schedules must respect the
  role model, hours, breaks and booking constraints. Invalid or concurrent edits
  cannot create an accepted overbooking.
- Barbers see permitted appointments, profile/services, schedule requests,
  personal reports and history. Manager/admin-only records remain protected.
- Staff booking transitions must be authorized and preserve historical snapshots.
  Completion payment-method recording is an accounting action, not a gateway
  charge. A booking is never automatically completed by the overdue reminder.
- Reminders target eligible staff for unchanged confirmed bookings 24 hours after
  appointment end; cancellation/rescheduling must invalidate obsolete reminders.

Manager routes live under `/dashboard` (setup, branches, barbers, services,
bookings, availability requests, My Chair, reports, finances, settlements and
billing). Barber routes live under `/barber` (bookings, availability, profile,
performance, logs, notifications and account settings). Agent booking/customer
routes remain under `/agent`. Do not restore retired conversation routes.

## 5. Reports, finances, settlements and subscriptions

These are separate financial concepts and must not be combined into one total:

| System | Meaning and constraints |
|---|---|
| Operational reports | Completed-booking sales use saved booking values and Kuwait appointment dates; they are not proof of money received, profit or barber wages. Reports/exports use consistent generated scope. |
| Manager Finances | Manual receipts, refunds, expenses, payments and corrections; integer fils, valid balances, reasons and idempotency. Cancellation does not automatically return money. Historical payments are never guessed from completed status. |
| Shop Settlements | Platform-collected booking amounts, commission/fee agreements, shop due and reconciliation. Verified external transfers are recorded, not executed by the website. |
| Billing & Subscription | Business pricing, term/access/capacity, renewal intent, grants, discounts and invoices. A quote or PDF is not proof of a gateway charge or settled payment. |

The recorded billing foundation uses integer fils: monthly price is the greater
of 25,000 fils and 10,000 fils per counted active barber; annual price is ten
monthly amounts. Active account barbers, managed profiles and My Chair follow
identity-deduplication/capacity rules; pending/inactive profiles do not count.
A first publication starts the configured one-time 14-day trial. Dated grants,
paid/trial/transition access and bounded renewal grace are distinct states;
republication does not reset trial and ordinary admin status is no billing bypass.
Future pricing changes must update both requirements and authoritative rules.

Capacity growth and new bookings/publication enforce access when activated;
existing history, cancellation and permitted rescheduling remain available.
Live gateway collection is postponed. PDF invoices use authoritative saved
invoice state/totals and cannot fabricate settlement. Preserve financial history
through catalog edits, shop transfers and permitted customer deletion.

Detailed definitions: [operational reports](docs/operational-reports.md),
[manager finances](docs/financial-reports.md),
[settlements](docs/shop-settlements.md),
[billing foundation](docs/subscription-foundation.md),
[access/capacity rules](docs/subscription-enforcement-test.md). Earlier Test labels
record the original phase; production status is reconciled in section 2.

## 6. Administration, security and data requirements

Admin routes include users/managers/barbers, account tools, subscriptions/discounts,
settlements/reconciliation, analytics, configuration/locations/templates,
Communications and audit/security/activity. Administrator management is additionally
Super Admin protected. MFA/live-session requirements apply at the server, not only
at route entry. Personal session revocation and account activity must not leak
other users' credentials or private records.

Authoritative authorization uses trusted app metadata, live session/revocation
checks and current relational ownership. Never trust client user metadata,
request-supplied actor/owner/price or hidden UI as permission. RLS/private schemas
and narrowly granted authenticated/service wrappers protect database access.
Customer, work and administrative views must apply their documented scopes.

Persist Auth identities, canonical customer profiles, shop/team ownership,
services/packages, availability, booking snapshots, account activity, financial
records and notifications through versioned migrations. Preserve existing
customer writes and migration hashes. Legacy table names need not match current
UI terminology. Do not use an old PRD's simplified schema as a migration source.

## 7. Architecture, environment and recovery

The website uses React 18, Vite, React Router, react-i18next and Supabase Auth,
PostgreSQL, Storage, Realtime and Deno Edge Functions. Module ownership follows
AGENTS.md; current dependencies/scripts are in [package.json](package.json).

Production retains Dokploy frontend hosting and separate self-hosted Supabase.
Hosted Test runs on Cloudflare Workers with isolated managed Supabase, private
access gate/inbox and synthetic fixtures. No production secrets, accounts or
customer rows may be substituted into Test. Localhost/Docker Test is used only
on an explicit owner request. There is no permanent staging/tag-promotion dependency.

Reviewed development flows through PR/CI into the production-triggering main
branch only with applicable release authorization. Immutable commit/artifact,
image, migration and attestation checks precede coordinated backend/frontend
release. Deployment status requires runtime evidence, not merely a successful push.

Current recovery policy is nightly encrypted off-host Backblaze backup at
03:15 Kuwait with isolated restoration verification. Up to about 24 hours of
customer changes may be lost when nightly cycles succeed; failed cycles increase
that window. The 26-hour receipt freshness allowance is a gate threshold, not an
improved recovery guarantee. The older 15-minute continuous-recovery objective
is retired. Fresh backup health must be measured at release/recovery time.

Compatible app/Functions rollback keeps the current database. It never blindly
reverses SQL or overwrites newer bookings with an old backup. Database disaster
recovery needs separate reviewed authorization and a data-reconciliation plan.

Runbooks: [environments](docs/environments.md),
[hosted Test](docs/cloud-test.md), [releases](docs/deployment-runbook.md),
[backup/recovery](docs/backup-restore.md). Do not infer today's backup success
from this policy description.

## 8. Acceptance and documentation maintenance

Every application/database/Functions change must receive appropriate checks and
hosted Test verification before being reported ready. Check affected roles,
permissions, layouts, themes, English/Arabic and persistence. Full regression is
a separate owner-triggered campaign, not a requirement on every website edit.

The [full regression plan](docs/testing/full-regression.md) has 65 initial
scenario groups across customer, barber, manager, admin, shared and conditional
capabilities. It is a plan, not completed automation or a pass certificate.
Expand version-relevant variants and report PASS, FAIL, BLOCKED, NOT RUN and
NOT APPLICABLE with evidence, target identity and verified fixture cleanup.
Do not claim exhaustive possible-case coverage or real-provider acceptance from
synthetic tests. A passing regression run does not authorize production release.

Update this inventory when a feature changes status. Record the exact deployed
version and evidence for promotion, keep Test-only branches/flags separate, and
retain explicit holds. Product status, working instructions and dated test/release
receipts have different purposes; reconcile conflicts rather than copying an
older preparation status forward. Native assignments, dependency requests and
publishing questions go through Apps Manager under AGENTS.md.
