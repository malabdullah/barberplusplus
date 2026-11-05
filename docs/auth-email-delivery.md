# Authentication email delivery

Production Auth uses Resend SMTP as `Barber++ <noreply@barberplusplus.com>`.
Zoho hosts `support@barberplusplus.com`; `noreply` is an alias of that mailbox,
so replies to automated messages reach support. Resend DKIM/return-path records
and Zoho MX/SPF/DKIM records coexist. `_dmarc` starts with `p=none`; inbox
placement remains the recipient provider's decision.

## Branded authentication links

`public/email/templates/` contains Go HTML templates and branded subjects for
confirmation, recovery, email changes, magic links and invitations. The existing
website callbacks use `/email/verify.html` as a same-origin entry page. A user's
explicit Continue click opens the original Supabase verification endpoint, which
then returns to the existing customer/staff callback, including `/accept-invite`. Simply fetching the email
link does not consume its token. Unknown callbacks, including native app deep
links, retain Supabase's original `ConfirmationURL` and behavior.

One-time token hashes and the encoded redirect are carried in a URL fragment,
never in the website's HTTP request URL. The page clears that fragment before
displaying its action, sends no referrer, validates its backend from the public
runtime configuration, and accepts only known same-origin callback paths and
the customer `next=book|account` option. Reloading the scrubbed page requires
reopening the complete email link. Supabase still validates token expiry and
one-time use. No password, role or customer record is stored by this page.

The one-time email code remains available for the customer's existing code-entry
screen. Do not enable Resend click/open tracking on authentication messages.

## Configuration and rollout

Verify the static entry page and all five templates on hosted Cloud Test first.
The Test Send Email hook remains enabled and captures synthetic messages; no
real email, production credentials or SMTP settings belong in Test. Template
URLs do not bypass its access gate. Use hook token data to exercise the same
branded link through Test's authenticated entry page.

Deploy the compatible frontend assets through dev, then the main production
release workflow. After verifying the exact production release and template
bytes, update only the Auth service's persistent runtime override:

* `GOTRUE_MAILER_TEMPLATES_<FLOW>` to the matching production HTTPS URL under
  `/email/templates/` (the lowercase flow filename plus `.html`).
* `GOTRUE_MAILER_SUBJECTS_<FLOW>` from `subjects.json`.

Use flow names `CONFIRMATION`, `RECOVERY`, `EMAIL_CHANGE`, `MAGIC_LINK`, `INVITE`.
Keep the existing SMTP secret, sender, provider, Auth image digest, callback
allowlist, database and Functions unchanged. Serialize with the backend release
lock. Preserve a private root-owned override backup and roll back/recreate only
Auth if its health/configuration or actual message rendering fails. Never print
the override, credentials, tokens or message links into logs or reports.

Check actual signup/recovery mail, code verification, expired/used link behavior,
customer booking continuation, staff recovery and unchanged native callbacks.
Check SPF, DKIM and DMARC from received headers, not just DNS or a provider's
Delivered badge. Test mailbox placement without changing the recipient's spam
preferences to influence the result. Restore temporary VPS access afterward.
