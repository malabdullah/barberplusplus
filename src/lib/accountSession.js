// Upgrade the old split browser storage without merging or deleting accounts.
export const LEGACY_CUSTOMER_KEY = 'barber-customer-auth';
export const ACCOUNT_NOTICE_KEY = 'barber-account-session-notice';
export function migrateAccountSession(storage, key) {
  try {
    const legacy = storage.getItem(LEGACY_CUSTOMER_KEY);
    if (!legacy) return;
    const current = storage.getItem(key);
    const oldSession = JSON.parse(legacy);
    if (!current && oldSession?.access_token && oldSession?.refresh_token) storage.setItem(key, legacy);
    else if (current && JSON.parse(current)?.user?.id !== oldSession?.user?.id) storage.setItem(ACCOUNT_NOTICE_KEY, '1');
    storage.removeItem(LEGACY_CUSTOMER_KEY);
    // An in-flight customer OAuth redirect still needs the existing PKCE verifier.
    const verifier = storage.getItem(`${LEGACY_CUSTOMER_KEY}-code-verifier`);
    if (verifier && !storage.getItem(`${key}-code-verifier`)) storage.setItem(`${key}-code-verifier`, verifier);
    storage.removeItem(`${LEGACY_CUSTOMER_KEY}-code-verifier`);
  } catch { /* Unavailable or malformed browser storage must not prevent login. */ }
}
export const customerCapable = role => ['customer', 'manager', 'barber'].includes(role);
export const workDestination = role => ({ manager: '/dashboard', barber: '/barber' })[role];
