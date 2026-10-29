# AI and outbound integrations

AI calls run in server-side Edge Functions. Keep provider keys out of the browser,
Git, images and release archives. The local Test profile supplies no real provider
key and sets AI_OUTBOUND_ENABLED=false. Real WhatsApp/email recipients and paid
integrations remain disabled by default; use synthetic fixtures and the local
mail viewer.

Production configuration belongs to the existing backend's protected secret
configuration. Enable paid AI only through a scoped, budgeted provider project
and test the relevant production integration deliberately. Application releases
preserve the backend gateway and its secret configuration.

The maintained Deno tests cover bounded requests, tool-call validation,
sequential execution, timeouts, quarantine and sanitized provider failures.
Run npm run test:functions after integration changes. Separate database/platform
upgrades from application delivery.
