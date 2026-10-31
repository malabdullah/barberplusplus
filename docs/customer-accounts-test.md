# Customer accounts in local Test

These changes are approved for dev and run only in the owned `barber-local-test` environment. They are not deployed to the live website. Existing phone accounts and bookings are preserved; use a fresh email address for testing.

## Journey

- `/customer/sign-up`: name, email, password and confirmation. The customer opens the confirmation link in the local mail catcher at `http://127.0.0.1:55324`. A resend action is available. The link returns to the account or a saved booking selection.
- `/customer/sign-in`: email and password. Customer and staff sessions remain separate.
- `/customer/forgot-password`: enter email to request a recovery link. `/customer/reset-password` accepts a new password after opening that link. Reset revokes existing sessions.
- `/customer/account`: view account email, edit name and optional phone, and request an email change. The current login email remains until the new address is confirmed.
- `/customer/auth-callback` and `/customer/complete-profile`: Google/Apple return and optional missing-name completion. Providers stay disabled until configured; see `customer-social-signin-test.md`.

Passwords require at least eight characters with uppercase, lowercase, number and symbol. Staff password rules are unchanged. Account creation does not require a phone. Before confirming a booking, a signed-in customer without a saved number enters a valid GCC number, which is saved as contact information. Guest bookings require a name and phone but no verification code.

## Ownership and safety

The customer gateway creates Auth users with the trusted customer role and requires a confirmed email. Profiles can exist without phones and do not link to business customer records by phone. Account booking ownership is recorded transactionally and history uses that ownership; shared phone numbers do not merge accounts or expose bookings. Legacy records retain their prior ownership without being attached to new accounts. Account passwords and staff sessions remain isolated.

Local messages use the Test-only mail catcher. Real email delivery and provider credentials require separate configuration before any future release. Do not reset the Test database to test these changes.

## Validation

Run `npm run check`, `npm run check:schema`, `npx supabase test db --local`, and `node scripts/probe-customer-email.mjs` from the owned checkout. The probe creates uniquely named synthetic records and removes only those records after testing. Browser checks should cover desktop and mobile in English and Arabic when local browser access is available.
