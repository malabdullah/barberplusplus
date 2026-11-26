# Architecture and shared-contract map

Maintained orientation, reconciled 26 November 2026. Read [handoff](handoff.md),
[AGENTS.md](../AGENTS.md) and [PRD.md](../PRD.md) for authority and status. This map
does not override version-specific API implementations or grant deployment access.

## System boundaries

| Component | Responsibility | Source / maintained instructions |
|---|---|---|
| Website | React 18/Vite/Router SPA, role/customer views, bilingual UI | `src/App.jsx`, `src/pages/`, `src/components/`, `src/context/`, `src/hooks/` |
| Browser service layer | Request construction, client adapters and data conversion | `src/services/`; service filenames identify the feature owner |
| Backend Functions | Authenticated public/customer gateways and staff/report/notification operations | `supabase/functions/<name>/index.ts`, shared validators in `_shared/` |
| PostgreSQL | Canonical records, ownership, RLS/private RPC boundaries, booking consistency and financial ledgers | `supabase/migrations/`, `supabase/schema.expected.sql`, `supabase/tests/` |
| Auth / Storage / Realtime | Identity/session, owned files and scoped updates | Current backend configuration plus versioned policies; not just UI checks |
| Hosted Test gateway | Access gate, private inbox, asset/runtime configuration, Function allowlist and synthetic fixtures | `ops/cloud-test/`, [Cloud Test](cloud-test.md) |
| Production delivery | Immutable GitHub artifacts, verified migration/Function coordination, Dokploy frontend | `ops/release/`, [release runbook](deployment-runbook.md), runtime lock |
| Native apps | Platform customer UI, secure sessions, booking journal/recovery, device integrations | Separate iOS/Android repositories and their PRD/AGENTS/design/contract documents |

Typical customer flow: client selection → environment-specific authenticated
Function gateway → live-session/ownership and business validation → transactional
booking/database routines → authoritative response/receipt → client state/history.
Staff services also use authorized database RPCs/queries where specified. Do not
assume every action traverses the same Function or uses service-role authority.

## Authorization and data invariants

Trusted app metadata, current sessions/revocation and relational ownership grant
access. Client role/actor IDs, UI hiding, shared contact information and a known
UUID never substitute for permission. RLS, explicit grants/private schemas and
server routines enforce the boundary. Admin and Super Admin are distinct; MFA
requirements apply to protected operations. Guest receipt capabilities, provider
proofs and deletion receipts are not ordinary login sessions.

Bookings retain saved price/duration and canonical ownership. Capacity, allowed
state changes, account linking, retries and concurrent writes are server enforced.
Financial values use integer fils and separate operational sales, manager
receipts/expenses, platform settlements and subscription billing. See PRD for
business rules; do not infer collection/payment from a completed booking or PDF.

Keep API/database `branch` identifiers while displaying shop/صالون outside admin.
Use Asia/Kuwait for the documented booking/report date rules and explicit UTC
boundaries where the contract requires them. Inspect the exact version before
changing serialization, optional contact fields, expiry or rounding behavior.

## Shared contract discovery

Feature documents below contain original phase verification/status as well as
contract details. Read their notice, then compare with source at the actual target
version. They are not permission to enable a held capability or rerun old commands.

| Concern | Website/shared source | Documentation |
|---|---|---|
| Customer identity/contact | `customerAuth.service.js`, `customer-auth`, canonical database routines | [Canonical profile](canonical-customer-profile.md), [shared work/customer modes](unified-customer-work-test.md) |
| Checkout and uncertain writes | `customerBooking.service.js`, `customer-booking`, booking guards | [Checkout](customer-booking-checkout.md), [discovery](booking-discovery.md), [booking emails/contact policy](customer-booking-emails.md) |
| Favourites / history / ratings | Customer services and authenticated account routines | [Favourites](customer-favourites.md), [history](customer-rebooking-test.md), current source and PRD |
| Public sharing / deep links | `bookingShare.service.js`, `booking-share`, booking-link helpers | [Permanent sharing](permanent-booking-sharing.md), [navigation](shared-booking-navigation.md), [app links](live-booking-app-links.md) |
| Account sessions / deletion | `accountTools.service.js`, `customerDeletion.service.js`, `account-tools`, `customer-account-deletion` | [Account tools](account-tools-test.md), [deletion](customer-account-deletion-release.md), [password contract](security/customer-password-handoff.md) |
| Team / shop setup | Team auth, invitation, setup/publication services and role-checked routines | [Invitations](shop-barber-invitations.md), [wizard](manager-setup-wizard.md), [onboarding follow-ups](onboarding-followups-test-20261125.md) |
| Reports / money / billing | `staff-reports`, reporting/finance/settlement/subscription services and private RPCs | [Operational](operational-reports.md), [finances](financial-reports.md), [settlements](shop-settlements.md), [billing](subscription-foundation.md) |
| Notifications / devices | Notification services, customer/admin dispatchers and platform registration contracts | [Dashboard notifications](dashboard-notifications.md), [announcements](admin-push-announcements.md), native contract docs through Apps Manager |

Native changes need an agreed field/error/idempotency/ownership/expiry contract
and environment/version identity from the backend owner through Apps Manager.
A provider transport existing in source does not mean delivery is enabled.
Capture/provider acceptance, device receipt and tap behavior are separate evidence.

## Schema and deployment boundaries

Migrations are timestamped, ordered and immutable after application. Schema replay
and exact pinned-image rehearsal are different from a live deployment. Baseline
adoption is historical; do not rerun CREATE statements against an existing database
or mark unknown effects applied. Reconcile current ledgers/fingerprint first.

Hosted Test uses isolated managed Supabase; production retains self-hosted Supabase
and Dokploy. Test and production credentials/data are never interchangeable.
Production deployment uses attested immutable artifacts, not a workstation build
or direct changes made from a native repository. Preserve current customer writes
on compatible app/Function rollback. Database restoration is separately reviewed
and can lose changes after the chosen recovery point.

Architecture changes must update this map, relevant contract documents, PRD and
working rules as appropriate. Verify runtime facts instead of relying on a dated
snapshot, a historic preparation heading or the latest Git commit alone.
