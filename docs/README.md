# Documentation index

Start with [handoff](handoff.md), then [AGENTS.md](../AGENTS.md) and
[PRD.md](../PRD.md). Product availability, operating rules, implementation
contracts and historical evidence are different kinds of information.

## Authority and conflict resolution

Latest owner instructions and applicable AGENTS.md govern scope/authorization.
Current operational runbooks govern procedures. PRD and the dated handoff snapshot
summarize feature state; actual runtime/accepted release receipts prove deployment.
Source and contracts must match the exact tested version. An old phase approval,
Test-only label or candidate record is not current release authority. Resolve
contradictions instead of executing whichever instructions look easiest.

## Maintained entry points and operational procedures

- [Barber++ maintainer and agent handoff](handoff.md)
- [Handoff state and unfinished work](handoff-state.md)
- [Architecture and shared-contract map](architecture.md)
- [Moving the workflow to another agent or machine](agent-portability.md)
- [Barber++ environments](environments.md)
- [Cloud Test](cloud-test.md)
- [Production releases](deployment-runbook.md)
- [Production backup and restoration](backup-restore.md)
- [PR documentation maintenance](documentation-policy.md)
- [Barber++ full functional regression plan](testing/full-regression.md) · [27 November closure and case matrix](testing/runs/20261127T051710Z-all-roles/README.md)
- [27 November production release verification](releases/admin-location-audit-2026-11-27.md)
- [Release records](releases/README.md)
- [Release review](releases/template.md)
- [Exact-resource cleanup](decommission-checklist.md)

`cloud-test.md` includes dated setup/verification history as well as maintained
procedures. Its initial fixture counts and versions are historical observations.
`deployment-runbook.md` retains the one-time cutover checklist; do not repeat
accepted baseline adoption. In `backup-restore.md`, the **Current daily policy**
section supersedes the explicitly retired continuous-protection design. All
recovery evidence needs a fresh original receipt at the time of the operation.

## Versioned contracts and historical feature/release records

These preserve original design, API and acceptance evidence. Most have a notice
at the top because old status words can differ from the current PRD. Match their
contract to target-version code, and use later accepted release evidence for
availability. Do not execute old cleanup, provider, migration or release steps
as onboarding. Some files contain both a useful contract and an old status;
neither a filename containing “Test” nor a preparation heading proves today's state.

- [Account sessions, activity and support](account-tools-test.md)
- [Admin push announcements — Phase 1](admin-push-announcements.md)
- [Super Admin and Admin — hosted Test acceptance](admin-role-hierarchy-test.md)
- [Retired messaging integration](ai-integration.md)
- [Android announcements: production candidate rehearsal](android-announcements-production-rehearsal-20261125.md)
- [Android Test authentication return contract](android-test-auth.md)
- [APNs credentials for USB and TestFlight installations](apns-environment-credentials.md)
- [Authentication email delivery](auth-email-delivery.md)
- [Availability approvals](availability-approvals.md)
- [Barber booking confirmation](barber-booking-confirmation.md)
- [Customer booking discovery](booking-discovery.md)
- [Canonical customer profiles](canonical-customer-profile.md)
- [Customer deletion: final production successor for review](customer-account-deletion-release.md)
- [Customer accounts in local Test](customer-accounts-test.md)
- [Customer booking checkout](customer-booking-checkout.md)
- [Booking update emails](customer-booking-emails.md)
- [Customer booking on dev and hosted Test](customer-booking-test.md)
- [Customer account deletion: production preparation](customer-deletion-production-readiness.md)
- [Account deletion after the reporting release](customer-deletion-reports-test.md)
- [Proposal: schema-faithful deletion rehearsal baseline](customer-deletion-schema-rehearsal-proposal.md)
- [Customer favourites](customer-favourites.md)
- [Customer checkout phone verification](customer-phone-verification.md)
- [Customer appointment history and rebooking](customer-rebooking-test.md)
- [Customer Google and Apple sign-in in Test](customer-social-signin-test.md)
- [Dashboard notifications](dashboard-notifications.md)
- [Existing production database adoption](database-baseline.md)
- [Manager financial reports — Phase 2 (Test)](financial-reports.md)
- [Shared phone number policy](global-phone-uniqueness-test.md)
- [Kuwait hosted Test catalog](kuwait-testing-catalog.md)
- [Live booking app links: prepared update](live-booking-app-links.md)
- [Approved logo rollout — 31 October 2026](logo-branding-test.md)
- [Manager shop setup](manager-setup-wizard.md)
- [Native customer backend release candidate](native-production-backend-candidate.md)
- [First-time native notification defaults](notification-first-setup.md)
- [Manager onboarding follow-ups — hosted Test](onboarding-followups-test-20261125.md)
- [Operational reports — Phase 1](operational-reports.md)
- [Permanent live booking sharing — Test release](permanent-booking-sharing.md)
- [Selective booking sharing/defaults production candidate](release-booking-sharing-2026-11-11.md)
- [Manager-only server installation contract — not executed](release-review/android-live-2026-11-20/MANAGER-INSTALL-INPUTS.md)
- [Android Live backend candidate — Test review](release-review/android-live-2026-11-20/REPORT.md)
- [Review and approval package](release-review/customer-deletion-2026-11-14/README.md)
- [Customer booking and account production preparation](releases/customer-accounts-production.md)
- [Independent Website release — 26 November 2026](releases/independent-2026-11-26.md)
- [Subscription foundation release](releases/subscriptions-2026-11-19.md)
- [Customer password security and native handoff](security/customer-password-handoff.md)
- [Shop service packages](service-packages.md)
- [Shared booking links](shared-booking-links.md)
- [Shared booking navigation — Test contract](shared-booking-navigation.md)
- [Shop barber invitations (hosted Test)](shop-barber-invitations.md)
- [Shop settlements](shop-settlements.md)
- [Real subscription enforcement — Test phase](subscription-enforcement-test.md)
- [Subscription foundation — hosted Test](subscription-foundation.md)
- [Team sign-in and manager social identities](team-social-signin-test.md)
- [One account, customer and work modes (hosted Test)](unified-customer-work-test.md)
- [WhatsApp retirement and production release](whatsapp-retirement.md)

## Planned or explicitly deferred scope

- [Private written reviews — future release](future-releases/private-written-reviews.md)
- [Subscription Billing — design preview](subscription-billing-preview.md)

## Design and presentation references

- [Barber++ logo lockup](logo-lockup.md)
- [Home Screen icons](home-screen-icons.md)
- [Unified public navigation](unified-public-navigation.md)

## Portable workflows

- [Project delivery instructions](agent-skills/project-delivery-workflow/SKILL.md).
- [Explicit-only regression instructions](agent-skills/full-regression-testing/SKILL.md).
- [Regression plan template](agent-skills/full-regression-testing/assets/plan-template.md).
- [Regression report template](agent-skills/full-regression-testing/assets/report-template.md).

The native repositories maintain their own platform handoffs/design systems.
Exact private access inventories, workspace manifests and operator receipts stay
with the coordinator, outside this public repository. See the handoff access section.

## Maintenance and checks

New or changed capabilities require the relevant PRD/contract/status update;
working-process changes require AGENTS/runbook updates. Review the start guide,
state snapshot and this index when affected. Historical evidence remains intact
with a clear notice and links to current authority. The documentation workflow
checks maintained handoff links and portable skill integrity in addition to the
existing PR declarations. Run `python3 scripts/verify-handoff-docs.py` locally;
private repository access and actual credential recovery cannot be certified by
that offline check.
