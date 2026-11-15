-- Administrative policies must use live role/session checks, not stale JWT role labels.
alter policy "Admins insert audit logs"on public.audit_logs with check((select public.is_admin())and admin_user_id=(select auth.uid()));
alter policy "Admins view all audit logs"on public.audit_logs using((select public.is_admin()));
alter policy "Admins view all logs"on public.logs using((select public.is_admin()));
alter policy "Admins manage suspicious activities"on public.suspicious_activities using(auth.jwt()->>'role'='service_role'or(select public.is_admin()))with check(auth.jwt()->>'role'='service_role'or(select public.is_admin()));
alter policy "Admins view suspicious activities"on public.suspicious_activities using(auth.jwt()->>'role'='service_role'or(select public.is_admin()));
alter policy "Admin realtime reads require MFA"on public.bookings using((select public.staff_factor_satisfied()));
alter policy "Admin realtime reads require MFA"on public.notifications using((select public.staff_factor_satisfied()));
alter policy "Admin realtime reads require MFA"on public.whatsapp_conversations using((select public.staff_factor_satisfied()));
alter policy "Admin realtime reads require MFA"on public.whatsapp_messages using((select public.staff_factor_satisfied()));
