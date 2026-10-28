> HISTORICAL: preview expired and was deleted 2026-10-28T10:39:12.594Z. This is not an active URL or current profile readiness receipt.

# Current preview acceptance — 2026-10-28 10:00 UTC

Source SHA: c82c6539ed1fd2db6eb39bd0dd7c7569bc938877.

PASS: actual owner browser landing, synthetic manager login, live dashboard/Arabic data, session across full-page navigation, seeded booking data. Owner confirmed at approximately 09:57 UTC that reopening the booking sidebar without reload/navigation displayed CLOUD_BROWSER_RT_20261028_1253. Source confirms modal-open reads in-memory booking state; postgres UPDATE handler fetches changed booking and updates AppContext. This establishes external browser Realtime-triggered refresh.

PASS: externally reported anonymous root, JS asset, Auth health and WebSocket upgrade returned 302 to Microsoft GitHub Auth with no app access. Local backend/proxy: 32 actual checks PASS (see backend-proxy-result.json), including five-role Auth, REST/Storage and denials.

NOT PROVEN: same physical browser WebSocket held continuously over 70 seconds with instrumented heartbeats; full backend acceptance beyond the recorded checks in this window. Do not infer these from elapsed login time.

Restoration: exact saved original notes restored and verified 2026-10-28T10:00:10.669252+00:00. Baseline 5 users, 1 booking, cron off. Only notes and automatic updated_at changed in this test. No other booking mutations authorized or performed during this check.

UI limitation: narrow-width sidebar close button hidden under fixed header; overlay click works. Recorded only; no source changes.

Active creator-only URL https://bh1dptgn-5180.use.devtunnels.ms; new resource barber-8f17d3fb516e94eec745c4b4. Original hard cutoff 2026-10-28T10:39:21.564Z, no extension/new tunnel. Retained bootstrap session 10123 still running at 10:00 UTC. Automatic cancellation/delete/Auth restoration pending; no cleanup success claim yet. Guarded lifecycle and hard timer remain configured. Earlier attempts' unknown resource/deletion status is preserved.

No publication, network expansion or existing-environment/source/RLS/SQL/workflow changes in this acceptance step.
