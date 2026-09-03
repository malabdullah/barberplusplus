-- Fix UPDATE policy for notifications
-- The original policy only allowed updating own notifications by recipient_user_id
-- This was too restrictive for managers who need to mark branch notifications as read

-- Drop the restrictive UPDATE policy
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;

-- Create policy allowing managers to update their own AND branch notifications
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE
  USING (
    auth.uid() = recipient_user_id
    OR EXISTS (
      SELECT 1 FROM public.branches
      WHERE branches.id = notifications.recipient_branch_id
      AND branches.manager_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = recipient_user_id
    OR EXISTS (
      SELECT 1 FROM public.branches
      WHERE branches.id = notifications.recipient_branch_id
      AND branches.manager_id = auth.uid()
    )
  );

-- Also fix DELETE policy to allow managers to delete branch notifications
DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;

CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE
  USING (
    auth.uid() = recipient_user_id
    OR EXISTS (
      SELECT 1 FROM public.branches
      WHERE branches.id = notifications.recipient_branch_id
      AND branches.manager_id = auth.uid()
    )
  );
