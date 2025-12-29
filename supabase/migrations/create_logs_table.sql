-- Create logs table for activity and error logging
CREATE TABLE public.logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(10) NOT NULL CHECK (level IN ('error', 'warning', 'info', 'debug')),
  log_type VARCHAR(20) NOT NULL CHECK (log_type IN ('error', 'action', 'navigation', 'system', 'auth')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role VARCHAR(20),
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  action VARCHAR(50),
  message TEXT NOT NULL,
  stack_trace TEXT,
  metadata JSONB DEFAULT '{}',
  user_agent TEXT,
  page_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX idx_logs_user_id ON public.logs(user_id);
CREATE INDEX idx_logs_branch_id ON public.logs(branch_id);
CREATE INDEX idx_logs_barber_id ON public.logs(barber_id);
CREATE INDEX idx_logs_level ON public.logs(level);
CREATE INDEX idx_logs_log_type ON public.logs(log_type);
CREATE INDEX idx_logs_created_at ON public.logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Policy: Barbers can only see their own logs
CREATE POLICY "Barbers view own logs" ON public.logs
  FOR SELECT
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'barber'
    )
  );

-- Policy: Managers can see all logs from their branches + their own logs
CREATE POLICY "Managers view branch logs" ON public.logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.branches
      WHERE branches.id = logs.branch_id
      AND branches.manager_id = auth.uid()
    )
    OR (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
        AND raw_user_meta_data->>'role' = 'manager'
      )
    )
  );

-- Policy: Admins can see all logs (future role)
CREATE POLICY "Admins view all logs" ON public.logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policy: All authenticated users can insert logs
CREATE POLICY "Users can insert logs" ON public.logs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
