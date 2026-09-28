# Booking assistant — GPT-6 Luna

Owner selected `gpt-6-luna` on 2026-09-28. This replaces the Anthropic
integration in source, not on any deployed environment. OpenRouter is not used.
Historical PRD/design documents describe the former architecture.

## Runtime contract

- The server-only `supabase/functions/_shared/ai.ts` adapter uses the OpenAI
  Responses API at a fixed HTTPS endpoint. Redirects are refused.
- Model is explicitly `gpt-6-luna`; there is no automatic model/provider fallback.
- Reasoning is `none` to preserve the previous non-thinking, latency-sensitive
  booking role. Output budget is 1,024 tokens. Live quality/latency is unproven.
- `store: false` disables Responses application-state storage; this is **not**
  a claim of zero provider retention. Review OpenAI data controls before real
  customer use.
- Requests expose only existing booking tools, with sequential tool calling.
  Existing optional argument semantics are retained using `strict: false`;
  local validation rejects unknown tool names, missing/unknown fields, wrong
  primitive/array types, invalid enums, incomplete responses and malformed JSON
  before tool execution. Existing business authorization remains essential.
- Full call/result history and call IDs are preserved through each tool round.
  The existing five-iteration limit remains. Tool outputs, not model claims,
  must determine whether bookings succeeded.
- Each attempt has a 15-second timeout, with at most three attempts. HTTP
  429/5xx and transport failures may retry; other HTTP and parsing errors do not.
  Errors never include provider response bodies or keys.

## Staging setup gate

1. Create a dedicated **Barber staging** OpenAI API project, separate from any
   production project. Review account terms and billing with the owner; the
   ChatGPT/Codex login is not an application API credential.
2. Obtain a server-only, project-scoped key with only the permissions needed for
   Responses. Store it as `OPENAI_API_KEY` in the private function secret store,
   never in Git, browser variables, chat or screenshots. Confirm Luna access.
3. Agree a test spending ceiling and configure available provider controls.
   Do not assume a budget alert is a hard spending cutoff. Add application-side
   request/token quotas before unattended or public use.
4. Keep `AI_OUTBOUND_ENABLED=false` until the synthetic-data, recipient
   allowlist, key isolation and budget checks pass. Initial VPS Compose forces
   the key empty and outbound disabled. Enabling requires a separately reviewed
   integration configuration and acceptance checks, not weakening the initial
   quarantine validator.
5. Enable only for a supervised synthetic test: Arabic, Kuwaiti dialect and
   English; relative dates/time zones; availability; confirmed booking;
   cancellation/rescheduling; missing details; provider failure; duplicate
   requests; unauthorized booking attempts and prompt injection.
6. Record actual model, calls/tokens, latency and results without messages,
   credentials or personal data. Verify the final DB state and WhatsApp delivery
   to the dedicated test recipient. Disable outbound again on failure.

No database migrations, production secret changes or production deployment are
part of this change. Unit fixtures and offline runtime checks cannot establish
Luna quality or real WhatsApp/DB end-to-end acceptance.

## Local validation — 2026-09-28

Source commit `ee5be09c4c47dc162ede045ba2b732c2be119b4f`:

- `npm run check`: passed, including nine mocked AI-client tests (14 total
  function tests), 48 VPS topology tests, 20 gateway tests and frontend build.
- `npm run test:e2e`: all five existing loopback browser tests passed. The first
  sandbox attempt could not bind port 4173; the authorized loopback rerun passed.
  These browser tests do not cover live WhatsApp or model behavior.
- `npm run test:staging-functions-package`: all four tests passed.
- Actual pinned upstream Compose + VPS overlay validation passed with public
  example values; no services were started by this configuration check.
- `npm run test:staging-edge-runtime`: all eight compiled workers passed the
  local ARM64, non-root/read-only, cold-start offline checks, including JWT,
  exact-route, cron, Meta HMAC and encrypted Flow ping/tamper boundaries.
  Source tree checksum:
  `1ae5b835359d5489a82eb110a5cc85579c8f18f90b54a9b8e5199477baa1ef12`.
- `git diff --check`: passed. No dependencies or migrations changed.

Pending: live Luna/key/model-access/cost/Arabic quality checks, data-backed
booking/cancellation/reschedule acceptance, new Linux AMD64 CI and actual VPS
deployment. No existing local database was reset or bootstrapped for this
adapter-only change; the eventual data-backed tests must use a fresh isolated
synthetic database. Production was not accessed. Existing frontend chunk-size
warnings remain.

## Official references

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/your-data
