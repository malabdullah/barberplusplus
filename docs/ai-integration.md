# Retired messaging integration

The WhatsApp and AI messaging workers are retired on the development branch.
Existing customer records and historical message data are preserved. The legacy
`whatsapp_agent` booking actor value remains in the database for compatibility
and is displayed as Agent. It does not enable messaging.

The customer iOS/Android application is a future project, as is a separate staff
application. Neither is implemented or advertised as available here. New mobile
authentication, authorization, notifications and data access must be designed and
reviewed separately. Local email remains confined to the local mail viewer.
