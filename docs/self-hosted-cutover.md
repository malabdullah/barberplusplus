# Self-hosted Supabase cutover

## Supabase host

The public API origin is `https://supabase.malabdullah.cloud`. The self-hosted
Supabase environment must use these values before the frontend is deployed:

```env
SUPABASE_PUBLIC_URL=https://supabase.malabdullah.cloud
API_EXTERNAL_URL=https://supabase.malabdullah.cloud/auth/v1
SITE_URL=https://barber.malabdullah.cloud
ADDITIONAL_REDIRECT_URLS=https://barber.malabdullah.cloud/reset-password,https://barber.malabdullah.cloud/accept-invite
```

Terminate TLS at the reverse proxy and forward WebSocket upgrades to the
Supabase API gateway. Recreate Auth and Functions containers after changing
their environment variables.

Before applying `20260901104047_self_hosted_cutover.sql`, add the browser-safe
publishable or legacy anon key to Vault using the command documented at the
top of that migration. Do not commit the key.

## Dokploy application

Create an application in `barber / production` with these settings:

- Repository: `https://github.com/malabdullah/barberplusplus.git`
- Branch: `main`
- Build type: Nixpacks
- Application port: `3000`
- Health check: `/`
- Domain: `barber.malabdullah.cloud`

Configure these build-time variables in Dokploy:

```env
VITE_SUPABASE_URL=https://supabase.malabdullah.cloud
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-legacy-anon-key>
```

## Cutover verification

1. Confirm Auth, REST, Storage, Realtime, and Functions routes accept the
   publishable key through the public HTTPS gateway.
2. Confirm `invite-barber`, `send-whatsapp-message`, `whatsapp-webhook`, and
   `send-booking-reminders` are deployed and have their required secrets.
3. Verify admin, manager, agent, and barber sign-in, MFA, password reset,
   invitations, CRUD, Storage uploads, and Realtime updates.
4. Check `barbers.avatar_url` and `branches.image_url` for the former hosted
   Storage origin. Verify each copied object before updating its origin.
5. Run the reminder cron once manually and confirm a successful response in
   `net._http_response` before relying on the hourly schedule.
6. Retain the hosted Supabase deployment until the rollback window closes.
