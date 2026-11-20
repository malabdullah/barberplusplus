begin;
-- Duration counts successful monthly subscription payments, not redemption age.
alter table private.billing_discount_codes
 drop constraint billing_discount_codes_payments_check,
 drop constraint billing_discount_codes_check1,
 add constraint billing_discount_codes_payments_check check(payments in(1,3,12)),
 add constraint billing_discount_codes_monthly_duration_check check(payments=1 or eligibility='monthly');
commit;
