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

## References

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/your-data
