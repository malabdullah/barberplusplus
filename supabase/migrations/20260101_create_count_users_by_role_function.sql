-- Create RPC function to count users by role
-- This function accesses auth.users table which requires SECURITY DEFINER
CREATE OR REPLACE FUNCTION count_users_by_role(role_filter text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM auth.users
  WHERE raw_user_meta_data ->> 'role' = role_filter;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION count_users_by_role(text) TO authenticated;
