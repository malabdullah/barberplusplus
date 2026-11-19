begin;
-- Account lifecycle remains owned by existing account-management routines.
-- Retain business/invoice/audit records without retaining a deleted identity.
alter table private.billing_businesses alter column origin_manager_id drop not null;
alter table private.billing_businesses alter column billing_manager_id drop not null;
alter table private.billing_businesses drop constraint billing_businesses_origin_manager_id_fkey;
alter table private.billing_businesses drop constraint billing_businesses_billing_manager_id_fkey;
alter table private.billing_businesses add foreign key(origin_manager_id)references auth.users(id)on delete set null;
alter table private.billing_businesses add foreign key(billing_manager_id)references auth.users(id)on delete set null;
alter table private.billing_access_grants alter column actor_id drop not null;
alter table private.billing_access_grants drop constraint billing_access_grants_actor_id_fkey;
alter table private.billing_access_grants add foreign key(actor_id)references auth.users(id)on delete set null;
alter table private.billing_audit drop constraint billing_audit_actor_id_fkey;
alter table private.billing_audit add foreign key(actor_id)references auth.users(id)on delete set null;
alter table private.billing_requests drop constraint billing_requests_actor_id_fkey;
alter table private.billing_requests add foreign key(actor_id)references auth.users(id)on delete cascade;
do $fix$
declare source text:=pg_get_functiondef('private.billing_business_view(uuid,uuid,boolean)'::regprocedure);fixed text;
begin
 fixed:=replace(source,'join auth.users u on u.id=b.billing_manager_id','left join auth.users u on u.id=b.billing_manager_id');
 if fixed=source then raise exception 'Subscription business view changed';end if;
 execute fixed;
end $fix$;
-- Every new foreign-key lookup used during account maintenance is indexed.
create index billing_grant_actor on private.billing_access_grants(actor_id);
create index billing_audit_actor on private.billing_audit(actor_id);
create index billing_redemptions_business on private.billing_redemptions(business_id);
commit;
