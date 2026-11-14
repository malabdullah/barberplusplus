-- Retain accounting history when a manager pauses or removes a shop.
alter table private.shop_finance_expenses add constraint finance_expense_shop_fk foreign key(shop_id)references public.branches(id)on delete restrict;
alter table private.shop_finance_entries add constraint finance_entry_shop_fk foreign key(shop_id)references public.branches(id)on delete restrict;
alter table private.shop_finance_entries add constraint finance_entry_booking_fk foreign key(booking_id)references public.bookings(id)on delete restrict;
create function private.guard_shop_finance_history()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if tg_table_name='branches'then
  if exists(select 1 from private.shop_finance_entries where shop_id=old.id)or exists(select 1 from private.shop_finance_expenses where shop_id=old.id)then
   raise exception 'FINANCE_HISTORY_PREVENTS_REMOVAL';end if;
  return old;
 end if;
 if new.branch_id is distinct from old.branch_id and exists(select 1 from private.shop_finance_entries where booking_id=old.id)then
  raise exception 'FINANCE_SHOP_CHANGE_FORBIDDEN';end if;
 return new;
end $$;
revoke all on function private.guard_shop_finance_history()from public,anon,authenticated,service_role;
create trigger finance_shop_history before delete on public.branches for each row execute function private.guard_shop_finance_history();
create trigger finance_booking_history before update of branch_id on public.bookings for each row execute function private.guard_shop_finance_history();
create function private.cleanup_shop_finance_reports()returns void
language sql security definer set search_path=''as $$
 delete from private.shop_finance_runs where id in(select id from private.shop_finance_runs where expires_at<=clock_timestamp()order by expires_at limit 100)
$$;
revoke all on function private.cleanup_shop_finance_reports()from public,anon,authenticated,service_role;
select cron.schedule('shop-finance-report-expiry','23 * * * *','select private.cleanup_shop_finance_reports()');
