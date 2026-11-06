const key = 'barber-pending-manager-registration';
export function rememberRegistration(value) {
  if (!value?.receipt) return;
  // This receipt only checks/resends this signup. Never retain passwords or an
  // Auth session in the verification page's refresh state.
  const pending = { receipt: value.receipt, email: value.email, expiresAt: value.expiresAt, resendAt: value.resendAt, confirmationRequired: true };
  try { sessionStorage.setItem(key, JSON.stringify(pending)); } catch { /* Keep the in-memory page available. */ }
}
export function forgetRegistration() { try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } }
export function pendingRegistration() {
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    if (typeof value?.receipt === 'string' && value.receipt.length <= 2048 && typeof value.email === 'string' && value.expiresAt > Date.now()) return value;
    forgetRegistration();
  } catch { /* A malformed or unavailable store must not block registration. */ }
  return null;
}
