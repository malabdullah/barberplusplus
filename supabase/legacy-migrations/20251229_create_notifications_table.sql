-- Create notifications table for real-time notifications system
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recipient targeting
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  recipient_role VARCHAR(20) CHECK (recipient_role IN ('manager', 'barber')),

  -- Content
  type VARCHAR(50) NOT NULL CHECK (type IN (
    'booking_created',
    'booking_cancelled',
    'booking_completed',
    'booking_status_changed',
    'booking_reminder',
    'barber_invite_accepted',
    'barber_availability_updated',
    'barber_profile_updated',
    'low_availability_warning',
    'system_alert'
  )),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,

  -- Related entity
  entity_type VARCHAR(50),
  entity_id UUID,

  -- State
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX idx_notifications_recipient_user ON public.notifications(recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX idx_notifications_recipient_branch ON public.notifications(recipient_branch_id) WHERE recipient_branch_id IS NOT NULL;
CREATE INDEX idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications(recipient_user_id, is_read, created_at DESC) WHERE recipient_user_id IS NOT NULL AND is_read = FALSE;
CREATE INDEX idx_notifications_entity ON public.notifications(entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Barbers can only see their own notifications
CREATE POLICY "Barbers view own notifications" ON public.notifications
  FOR SELECT
  USING (
    auth.uid() = recipient_user_id
    AND EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'barber'
    )
  );

-- Policy: Managers can see branch notifications + their own
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
      AND EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
        AND raw_user_meta_data->>'role' = 'manager'
      )
    )
  );

-- Policy: Users can update their own notifications (mark as read)
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE
  USING (auth.uid() = recipient_user_id)
  WITH CHECK (auth.uid() = recipient_user_id);

-- Policy: Authenticated users can insert notifications
CREATE POLICY "Users insert notifications" ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Policy: Users can delete their own notifications
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE
  USING (auth.uid() = recipient_user_id);

-- Enable realtime for the notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
