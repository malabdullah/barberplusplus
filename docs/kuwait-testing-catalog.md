# Kuwait hosted Test catalog

The owner requested five shops in each of two cities per governorate. This adds
60 shops, 180 barbers, 360 services and 240 staff logins only to hosted Test:
https://barber-test.alabdullah-cs.workers.dev, Supabase `qvkucvcjmojjbphlzlks`.
Production and existing records are preserved; the admin user is not modified.

| Governorate | Cities |
| --- | --- |
| Capital | Sharq; Mirqab |
| Hawalli | Hawalli; Salmiya |
| Farwaniya | Farwaniya; Khaitan |
| Ahmadi | Fahaheel; Mangaf |
| Jahra | Jahra; Saad Al-Abdullah |
| Mubarak Al-Kabeer | Sabah Al-Salem; Mubarak Al-Kabeer |

Every city has Classic Cuts, Urban Fade, Beard Studio, Gentlemen Lounge and Express
Groom shops, numbered 01–05 and prefixed **Test** (تجريبي). Existing legacy shops
may also appear, especially in Salmiya. Each new shop has one manager and three
accepted, active barbers with email/password login. Each barber has three assigned
services, with distinct specialties. Six services per shop cover haircuts, beards,
skin fades, combinations, facial care and wash/style, with 15–60 minute durations
and varied KWD prices. All names and saved areas include Arabic equivalents.

| Barber | Hours except Friday | Weekly day off | Daily break | Booking limit |
| --- | --- | --- | --- | --- |
| Omar | 09:00–18:00 | Tuesday | 13:00–13:30 | 14 days |
| Yousef | 10:00–20:00 | Wednesday | 14:30–15:00 | 21 days |
| Ali | 12:00–21:00 | Sunday | 16:00–16:30 | 30 days |

Friday hours are 14:00–21:00. Omar's Friday break is 15:00–15:30. Every barber
also has a one-time 17:00–18:00 training block and a three-day vacation. Dates are
anchored to initial creation in Kuwait time; idempotent re-runs do not move them
or overwrite user-edited availability.

For shops numbered 01 and 04, training starts 4 November 2026 (Yousef's is moved
to 5 November because Wednesday is his day off). Shops 02/05 use 5 November;
shop 03 uses 6 November. All training blocks are on working days.

| Shop numbers | Omar vacation | Yousef vacation | Ali vacation |
| --- | --- | --- | --- |
| 01 and 04 | 8–10 Nov 2026 | 12–14 Nov 2026 | 16–18 Nov 2026 |
| 02 and 05 | 9–11 Nov 2026 | 13–15 Nov 2026 | 17–19 Nov 2026 |
| 03 | 10–12 Nov 2026 | 14–16 Nov 2026 | 18–20 Nov 2026 |

Use these dates to check that unavailable slots disappear, vacation days have no
slots, service combinations respect their full duration, and each barber's booking
window is enforced. Slots and dates use Kuwait time (UTC+3).

## Staff accounts

Email patterns (city slug is lowercase with spaces replaced by hyphens):

- Manager: `manager.sharq.01@barber.test`.
- Barbers: `barber.sharq.01.1@barber.test`, `.2@barber.test`, `.3@barber.test`.

The same pattern applies to every listed city and shop 01–05. These accounts use
the existing synthetic Test staff password, copied as a password hash from the
ordinary Test agent inside the database. No password is in this repository.
Owner-only login details are in the ignored private handover produced for this
fixture. Use normal team sign-in; the manager sees only their shop, and the barber
can manage their availability from the barber workspace.

## Applying or checking the fixture

`ops/cloud-test/fixtures/kuwait-catalog.sql` is data-only seed source with Test
mailbox, role and location guards. Run it only with the Supabase SQL tool's explicit
`project_id=qvkucvcjmojjbphlzlks`. Preview by replacing its final COMMIT with
ROLLBACK. It preserves fingerprints of every pre-existing Auth user, shop, barber,
service and appointment before committing. Existing fixture IDs are not updated.

`ops/cloud-test/fixtures/verify-kuwait-catalog.sql` checks every barber's working
hours, recurring breaks, one-time time off, vacation, day off, booking window,
assigned services and combined service totals through the actual booking routine.
It is read-only and rolls back. These files are deliberately outside application
migrations and are not included in production release payloads.
