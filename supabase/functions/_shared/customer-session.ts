export function sessionId(token: string): string {
  try {
    const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const id = JSON.parse(atob(payload)).session_id;
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : '';
  } catch { return ''; }
}
// Call only after Auth.getUser has validated the bearer token. This decoded
// claim is never an authentication or role decision by itself.
export async function customerIdentity(admin: { auth: { getUser: (jwt: string) => Promise<{data: {user: {id: string; app_metadata: Record<string, unknown>} | null}; error: unknown}> } }, token: string) {
  const {data,error} = await admin.auth.getUser(token);
  const id = sessionId(token);
  return !error && data.user?.app_metadata.role === 'customer' && id ? {user_id:data.user.id,session_id:id} : null;
}
