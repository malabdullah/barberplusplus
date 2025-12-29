-- Fix SELECT policies that were querying auth.users table directly
-- The authenticated client doesn't have permission to access auth.users
-- Use auth.jwt() instead which reads from the JWT token directly

-- Drop existing SELECT policies that query auth.users
DROP POLICY IF EXISTS "Barbers view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Managers view branch notifications" ON public.notifications;

-- Recreate using auth.jwt() instead of auth.users
CREATE POLICY "Barbers view own notifications" ON public.notifications
  FOR SELECT
  USING (
    auth.uid() = recipient_user_id
    AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'barber'
  );

CREATE POLICY "Managers view branch notifications" ON public.notifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.branches
      WHERE branches.id = notifications.recipient_branch_id
      AND branches.manager_id = auth.uid()
    )
    OR (
      auth.uid() = recipient_user_id
      AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'manager'
    )
  );
