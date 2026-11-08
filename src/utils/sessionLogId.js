// Correlation only: these claims never authorize an action or identify a user.
// Never write a JWT or a fragment of its encoded payload into the activity log.
export function getLogSessionId(accessToken) {
  try {
    const payload = accessToken?.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id || '') ? claims.session_id : null;
  } catch { return null; }
}
