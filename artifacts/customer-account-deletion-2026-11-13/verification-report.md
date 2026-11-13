# Customer account deletion — Test verification

13 November 2026. Frontend source `13f11e819f46e0eb6a0505d7c494c4238cbc98dc`.
Supabase `qvkucvcjmojjbphlzlks`; Function `customer-account-deletion` version 1.
Only codex/customer-account-deletion-test was pushed. Dev, main and production
were not changed. The existing reports layout is preserved.

| Scenario | Observed result |
| --- | --- |
| Missing/expired session, forged fields, hostile origin or wrong gateway key | Denied before deletion; privileged RPC denied to anon/authenticated |
| Ordinary/nonallowlisted customer or linked manager/staff | Denied; pilot requires trusted disposable-QA metadata on every alias |
| Verified destination and proof | Destination masked; actual code captured privately; wrong code rejected and correct code accepted |
| Start retry after uncertain response | Same operation returns same receipt without an extra email |
| Tampered receipt, wrong operation/key | Rejected; AES-GCM receipt binding and hashed status authorization verified |
| Five wrong attempts, repeated sends, expired proof | Bounded attempt/send windows enforced; explicit reauthentication required |
| Delete without explicit cancellation consent | Rejected |
| New/changed future appointment after preview | New preview returned; original account and appointments remain until re-confirmed |
| Accepted deletion | Future pending/confirmed visits cancelled; live sessions removed immediately |
| Past completed visit | Anonymous service/date/duration/amount retained; private notes removed |
| Ratings, favourites and sharing | Removed; saved report payload anonymized and old snapshots invalidated |
| Report already buffering an Excel file | Initial/final readiness checks prevent offering a stale file |
| Reused notification device | Deleted owner's registration removed; device now belonging to another account preserved |
| App-verified phone on an email Auth account | Included in deterministic contact cleanup even if auth.users.phone is empty |
| Storage/Auth background cleanup | Leased, retryable status remains available after session removal; three actual disposable Test deletions completed |
| Old access token after deletion | HTTP401; Auth identity lookup HTTP404 |
| Account switched during an in-flight response | Another account's session/drafts are preserved |
| Website confirmation response lost | Same saved receipt is polled; no replacement operation started |
| Page refreshed after completion | Completion recovered signed out using receipt |
| Public support and privacy | Accessible without an application account; Test access gate preserved |
| English/light and Arabic/RTL/dark mobile | Localized counts/provider text, clear action contrast, no horizontal overflow |
| Safari mobile | Public privacy passed after the harness established the normal private-gate cookie |

Full project check passed: 224 Function tests, 365 UI/unit tests, 63 operation
checks, lint, migration/domain checks and build. Four additional deletion UI tests
passed, and final targeted flow/export/ownership checks passed after visual fixes.
The expanded hosted database suite was rolled back completely; it left no fixture
records. Three separate real API/browser disposable deletions reached complete,
with zero cleanup-pending jobs at closeout. A dedicated review account remains.

Issues found and fixed: PL/pgSQL variable ambiguity; GoTrue rejected an infinite
ban timestamp (finite suspension now used); session deletion detached device
ownership before cleanup (owned registrations now removed first); missing
translation interpolation; light-theme action specificity/contrast; and app-level
verified phones absent from auth.users. Safari's first failure was harness gate
authentication, not an application exception.

Native QA is a separate active check. Its dedicated disposable account has two
future visits and one completed past visit plus favourites/rating/share data; no
creation email/push/staff notifications escaped the seed transaction. Do not claim
native device success until that chat records its result.

Not released: production mail adapter/explicit enablement and compatible release
candidate, final public production privacy/App Privacy acceptance, production or
TestFlight deployment. Automatic Apple revocation is not implemented; the manual
Apple Account fallback is documented. Account deletion cannot recall delivered
emails, downloaded files or external recipient/provider copies.
