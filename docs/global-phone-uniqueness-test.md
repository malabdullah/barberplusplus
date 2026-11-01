# Shared phone number policy

Hosted Test enforces one international contact number across customers, every
staff role (including admin), barbers and shop contacts. Empty optional contact
fields do not reserve numbers. Country codes are part of the number. Spacing,
punctuation, Arabic digits, international prefixes and domestic Saudi/UAE trunk
prefixes cannot create separate claims for the same number.

The private registry uses a primary key and conditional UPSERT to enforce the
rule under concurrent writes, with ordered transaction locks for source changes.
It covers Auth native phone and staff profile metadata, public customers,
barbers, branches and private customer accounts. A staff identity and its linked
barber record are the same person. A customer's one account and one business
contact are representations of the same contact; their number never confers
appointment ownership. Existing live-session, trusted-role and booking ownership
checks remain in place. No public phone-owner lookup endpoint is added.

Phone fields are normalized before writes so existing customer upserts continue
to reuse the same contact. The private redundant phone_e164 field is derived from
country_code and phone. Source removal releases a number only when no other
representation still holds it. Inactive records retain their number until it is
removed or changed.

Three deliberately shared-phone fixture pairs were found in Test. Only the
three generated, email-only fixture accounts without owned appointments received
distinct synthetic numbers. Their original values are retained in an ignored
private backup. No accounts, bookings or production data were removed.

The policy is a separately reviewed production change. Before any promotion,
audit production for conflicts and obtain decisions for real records; migrations
fail closed rather than choosing an owner or changing real customer phone data.
Do not combine a production data cleanup with an automatic release. Main and
production remain unchanged while Test is reviewed.

Validation on hosted Test includes 35 phone-policy pgTAP assertions, 17 email
account/ownership regression assertions and API checks through ordinary synthetic
customer, admin, manager and barber sessions. Concurrent authorized customer and
barber inserts result in one successful claim and one PHONE_IN_USE rejection.
Guest bookings cannot use a shop contact number. Valid profile changes preserve
owned appointment history. Named inactive shop/barber fixtures used for these
checks are retained in Test; their identifiers are recorded in ignored private
verification manifests. No remote cleanup deletions are performed.
