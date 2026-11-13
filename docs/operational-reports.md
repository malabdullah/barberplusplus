# Operational reports — Phase 1

The owner authorized Phase 1 implementation on 13 November 2026: “go ahead and
complete phase 1 now”, after selecting and reviewing the report designs. Delivery
is to hosted Test only. Main, production and native iOS remain outside this change.

## Use

- Managers: **Reports** in the workspace, `/dashboard/reports`.
- Barbers: **My performance**, `/barber/performance`; only their own authorized
  barber history is available. Managers with a chair can select My performance
  in the Reports selector without a second account.
- Choose report, period and (for multiple shops) shop scope; Generate report.
  Overview adapts from shops to barbers when one shop is selected. View shop
  generates a fresh result scoped to that shop with the same date criteria.
- Report choices: Overview, Shops, Barbers, Services & packages, Bookings,
  Customers, Demand and Ratings. Barber personal reports omit Shops and Barbers.
- Export Excel downloads the entire generated result, not only the current page.
  Appointment search/status filters browse the result; they do not regenerate its
  summary. Changing report criteria disables export until regeneration.

The default screen prioritizes the breakdown, a short summary and a value trend.
Additional metrics/definitions are collapsed. Mobile stacks the summary,
breakdown, trend and status; filters use a keyboard-operable dialog. Arabic,
light and the current #141414 dark theme use existing application conventions.
The trend uses daily, weekly or longer calendar buckets according to the selected
range. Missing days within the generated period are zero, and Chart data exposes
the exact period totals without relying on chart tooltips.

## Meaning of the numbers

Completed sales are saved completed-booking values, **not money collected,
profit, commissions or barber wages**. There is no payment ledger or expense
entry in this phase. Those belong to the later financial phase.

Use Kuwait appointment dates, saved prices/durations and current authorized
statuses. A catalogue edit does not reprice history. A newly generated report
reflects corrections; an earlier snapshot and its downloaded workbook stay fixed.

Customers served deduplicates canonical records across selected shops. New and
returning classification is relative to the selected shop set (barber-specific
for personal scope); multiple visits in the same month do not count a new person
again. Unlinked guests are not merged by a guessed name, email or phone.

Package prices count once, with saved add-on prices. Included services carry usage
counts without additional value. Missing historical allocations and differences
between line values and the saved booking total appear as Unallocated, including
negative reconciliation values. Never reconstruct old prices from the catalogue.

Past-ended appointments, including unresolved pending/confirmed visits, form the
performance-percentage denominator. Future pending/confirmed duration is separate.
Ratings provide separate shop/barber averages and submission counts; absence is
not a zero-star score. Demand reports completed booked duration and start-hour/day
patterns; historical occupancy and reschedule-event counts are unavailable where
the required event/availability history is not reliable.

## Snapshot and API architecture

`staff-reports` is an independently authenticated Edge Function. POST accepts
only type, personal, shopIds, preset, from and to. It forwards the caller's JWT to
Postgres, creates a run and retains the build with EdgeRuntime.waitUntil. It does
not use the service-role key to impersonate a user. Cloud Test additionally
requires the existing gateway boundary and explicit Test project.

The authenticated RPC `staff_reports(action, data)` supports options, create,
build, get, rows, groups and failure recording. Every action verifies a live
session, trusted current manager/barber role, ownership and current shop/barber
access. A retained run is denied after suspension, session revocation, relevant
shop transfer, identity reassignment or expiry. Reporting grants no editing rights.
Admin, agent and customer roles cannot enter this reporting API.

Three private RLS-enabled, deny-by-default tables retain run metadata, row
snapshots and paginated groups. Neither public clients nor the generic service
role have direct table privileges. The narrow, search-path-hardened RPC is the
intentional SECURITY DEFINER boundary. Its authenticated-execution advisor notice
is expected; denial paths are covered by SQL tests. No permissive table policies
are added to silence private-table informational notices.

One INSERT statement captures both current and comparison periods, canonical
identity, saved prices/services/packages, ratings and customer classification.
All aggregates and detail/export pages subsequently use these captured rows.
The report preview carries at most 20 breakdown rows; detail requests are capped
at 500 plus one lookahead row, using cursor pagination. Indexes cover shop/date,
barber/date and prior completed customer visits. Allocations aggregate once before
reconciliation, avoiding a repeated full scan per booking.

Runs expire after 24 hours. An hourly cron removes up to 100 expired runs and
cascades only their report artifacts; generation also cleans its owner's expired
runs. No business records or bookings are deleted. Abandoned background jobs
become failed after three minutes rather than appearing as successful zero data.

Initial limits: 30 requests per account/hour, up to 500 authorized shops, one year
per selection, 100,000 current appointments and 200,000 captured rows across both
periods. Oversize reports fail clearly and request a smaller scope. There is no
silent truncation. Large generation stays on the server; row pages remain bounded.

## Excel

The export is generated in a dedicated browser Web Worker using pinned ExcelJS
4.4.0. Its UUID dependency is pinned to compatible patched 11.1.1. The writer is
loaded only when exporting, not in the initial report screen bundle.

Sheets: Summary, Breakdown, Appointments and Definitions. Values use typed numeric
cells with three KWD decimals, typed Kuwait wall-clock dates, frozen headings and
filters. Free text remains literal strings, never formula/hyperlink objects.
The workbook excludes contact phone/email, notes and credentials. Definitions
identify scope, comparison bounds, timezone, snapshot ID and metric limitations.

All matching snapshot rows/groups are fetched in authorized pages and sent to the
worker. There is progress/cancel/error handling and a final authorization check
before offering the Blob download. No workbook is uploaded to a public bucket or
shared by URL. A user-held downloaded copy naturally cannot be revoked remotely.

## Operations and validation

Migrations:

1. `20261113081244_operational_reports_phase_one.sql`
2. `20261113083440_operational_report_retention.sql`
3. `20261113083753_optimize_operational_report_aggregation.sql`

No production environment variable is changed. The Edge Function needs the
standard Supabase URL/anon key and APP_URL; Test retains its gateway secret.
Cloudflare upload must preserve both secret bindings **and the ASSETS binding**.

Checks: npm run check, the new SQL suites 051/052, hosted reports-probe.mjs and
reports.spec.js. Browser QA uses dedicated synthetic accounts; their private
credentials are kept in ignored `.cloud-test/reports-qa.json`. No real SMS/email
is requested. The QA shops stay draft, so they do not appear in customer discovery.

Local website/Docker remain disabled per owner instruction. The three new
migrations were replayed with isolated temporary report objects in a rolled-back
hosted transaction, followed by the authorization/calculation suite. Live public
function/index/ACL identity is checked separately. This is not a claim of exact
self-hosted production-image parity; promotion requires its own release checks.

The default unit worker count is bounded to two to avoid CPU/memory contention
with device QA. Assertions and test deadlines are unchanged.
