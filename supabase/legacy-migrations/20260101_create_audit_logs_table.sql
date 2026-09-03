-- Create audit_logs table for admin audit trail
-- Distinct from the general logs table which handles application-level logging
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_entity_type VARCHAR(50),
  target_entity_id VARCHAR(100),
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Action type constraint for known action types (lowercase to match frontend)
ALTER TABLE public.audit_logs
  ADD CONSTRAINT valid_action_type
  CHECK (action_type IN (
    -- User management
    'manager_enabled', 'manager_disabled',
    'barber_enabled', 'barber_disabled',
    'user_created', 'user_updated', 'user_deleted',
    'user_disabled', 'user_enabled', 'role_assigned',
    -- Configuration
    'settings_changed', 'template_updated',
    'location_modified', 'branch_modified',
    'barber_modified', 'service_modified',
    'booking_modified', 'system_config',
    -- Security events
    'login_success', 'login_failure', 'logout',
    'password_reset_requested', 'password_reset_completed',
    'permission_denied', 'suspicious_activity',
    'session_expired', 'account_locked', 'account_unlocked',
    'security_event',
    -- Admin actions
    'data_export', 'import_data', 'bulk_operation'
  ));

-- Indexes for common query patterns
CREATE INDEX idx_audit_logs_admin_user_id ON public.audit_logs(admin_user_id);
CREATE INDEX idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX idx_audit_logs_target_user_id ON public.audit_logs(target_user_id);
CREATE INDEX idx_audit_logs_target_entity ON public.audit_logs(target_entity_type, target_entity_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Specialized index for security events (faster security dashboard queries)
CREATE INDEX idx_audit_logs_security ON public.audit_logs(action_type)
  WHERE action_type IN (
    'login_failure', 'permission_denied', 'suspicious_activity',
    'account_locked', 'session_expired'
  );

-- Enable Row Level Security
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can view all audit logs
CREATE POLICY "Admins view all audit logs" ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: Admins can insert audit logs
CREATE POLICY "Admins insert audit logs" ON public.audit_logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: System/service role can also insert (for auth event logging)
-- Note: Service role bypasses RLS by default, so no explicit policy needed

-- Comment for documentation
COMMENT ON TABLE public.audit_logs IS 'Admin audit trail for tracking all administrative actions and security events';
COMMENT ON COLUMN public.audit_logs.action_type IS 'Type of action performed (e.g., MANAGER_ENABLED, LOGIN_FAILURE)';
COMMENT ON COLUMN public.audit_logs.old_values IS 'Previous values before the change (JSONB)';
COMMENT ON COLUMN public.audit_logs.new_values IS 'New values after the change (JSONB)';
