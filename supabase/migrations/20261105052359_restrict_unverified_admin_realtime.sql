begin;

create policy "Admin realtime reads require MFA" on public.bookings
as restrictive for select to authenticated
using (((select auth.jwt()->'app_metadata'->>'role') is distinct from 'admin')
  or ((select auth.jwt()->>'aal') = 'aal2'));

create policy "Admin realtime reads require MFA" on public.notifications
as restrictive for select to authenticated
using (((select auth.jwt()->'app_metadata'->>'role') is distinct from 'admin')
  or ((select auth.jwt()->>'aal') = 'aal2'));

create policy "Admin realtime reads require MFA" on public.whatsapp_conversations
as restrictive for select to authenticated
using (((select auth.jwt()->'app_metadata'->>'role') is distinct from 'admin')
  or ((select auth.jwt()->>'aal') = 'aal2'));

create policy "Admin realtime reads require MFA" on public.whatsapp_messages
as restrictive for select to authenticated
using (((select auth.jwt()->'app_metadata'->>'role') is distinct from 'admin')
  or ((select auth.jwt()->>'aal') = 'aal2'));

commit;

