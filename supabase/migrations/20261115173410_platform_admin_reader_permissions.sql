begin;
-- Do not inherit default browser grants when these optional readers are new.
revoke all on function public.account_activity(bigint),public.shop_reviews(integer) from public,anon,authenticated,service_role;
grant execute on function public.account_activity(bigint),public.shop_reviews(integer) to authenticated;
commit;
