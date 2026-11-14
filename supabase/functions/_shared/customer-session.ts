export function sessionId(token: string): string {
  try {
    const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const id = JSON.parse(atob(payload)).session_id;
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : '';
  } catch { return ''; }
}
// Call only after Auth.getUser has validated the bearer token. This decoded
// claim is never an authentication or role decision by itself.
type IdentityClient = {
  auth: {
    getUser: (jwt: string) => Promise<{
      data: { user: { id: string; app_metadata: Record<string, unknown> } | null };
      error: unknown;
    }>;
  };
  rpc: (name: 'customer_session_is_live' | 'staff_token_factor_satisfied', params: { p_user: string; p_session: string; p_aal?: string }) =>
    PromiseLike<{ data: unknown; error: unknown }>;
};

export async function customerIdentity(admin: IdentityClient, token: string) {
  const { data, error } = await admin.auth.getUser(token);
  const id = sessionId(token);
  if (error || !data.user || !['customer', 'manager', 'barber'].includes(String(data.user?.app_metadata.role)) || !id) return null;
  const live = await admin.rpc('customer_session_is_live', { p_user: data.user.id, p_session: id });
  if (live.error || live.data !== true) return null;
  const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
  const factor = await admin.rpc('staff_token_factor_satisfied', { p_user: data.user.id, p_session: id, p_aal: String(claims.aal || '') });
  if (factor.error || factor.data !== true) return null;
  return { user_id: data.user.id, session_id: id };
}
