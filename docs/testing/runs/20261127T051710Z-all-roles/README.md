# Website regression closure · 27 November 2026

**Closed on hosted Test. All 311 applicable variants passed.** Of 320 planned variants, nine were excluded. None failed, remained blocked or went unrun within scope. Refund processing was excluded by the owner. The initial run used website revision `ec788dd`. The location audit fix and the final authenticated browser retest used `01be4ba` on the same Test project. The backend inventory matched across both revisions at 255 migrations and 26 Functions.

| Scope | Passed | Excluded |
|---|---:|---:|
| Public | 2 | 0 |
| Customer | 70 | 0 |
| Barber | 38 | 1 |
| Manager | 60 | 0 |
| Admin | 44 | 1 |
| Super Admin | 23 | 0 |
| Legacy agent | 1 | 0 |
| Shared | 19 | 0 |
| Conditional | 54 | 7 |

The shop-first, barber-first and time-first browser bookings each reached staff completion with one cash receipt and one ledger entry. A fourth booking passed rescheduling and completion. The three original public links still showed the completed bookings after disposable customer deletion. The initial failures in publication, chair and rating assertions were corrected and retested.

An ordinary Admin created and deleted a disposable Test location. Both audit entries recorded the correct actor and location ID. The fix subsequently shipped to production. [Release record](../../../releases/admin-location-audit-2026-11-27.md)

The corrected analytics runner waited for the dashboard after MFA. In the authenticated browser, the dashboard showed 13 bookings and KWD 4.000 revenue from four completed appointments, matching the hosted response. A browser request for an empty Test date returned zero rows, and the booking-status chart showed “No data for selected period.” The isolated session signed out. [Browser results](analytics-browser-retest.json)

Five external Google and Apple sign-in variants were skipped at the owner's request. The other exclusions were phone verification under the email-only Test setting, My Chair for the barber role, paging in unpaginated Admin directories, and native push delivery in a website run. The case matrix records the final status and evidence time for each variant. [Case matrix](cases.csv) · [Regression plan](../../full-regression.md)
