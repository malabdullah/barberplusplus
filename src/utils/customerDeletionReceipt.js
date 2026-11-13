import { ACCOUNT_AUTH_STORAGE_KEY } from '../lib/supabase';
const KEY = 'barber-customer-deletion';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function deletionReceipt() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY));
    if (value && uuid.test(value.id) && uuid.test(value.ownerId) && (!value.receipt || /^[A-Za-z0-9_-]{43}$/.test(value.receipt)) && value.savedAt <= Date.now() && value.savedAt > Date.now() - 7 * 86400000) return value;
  } catch { /* An unavailable browser store requires restarting before confirmation. */ }
  return null;
}
export function saveDeletionReceipt(value) {
  // Fail closed: never confirm deletion if a refresh would lose its recovery receipt.
  sessionStorage.setItem(KEY, JSON.stringify({ id: value.id, ownerId: value.ownerId, receipt: value.receipt, phase: value.phase, appleManualRevocation: value.appleManualRevocation === true, savedAt: Date.now() }));
}
export function clearDeletedBrowserAccount(ownerId) {
  // No await between comparing the current owner and removing their local keys.
  // Never call signOut after an asynchronous deletion: it could target a new user.
  try {
    const raw = localStorage.getItem(ACCOUNT_AUTH_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : null;
    if (current?.user?.id !== ownerId) return false;
    for (const key of [ACCOUNT_AUTH_STORAGE_KEY, `${ACCOUNT_AUTH_STORAGE_KEY}-code-verifier`, `${ACCOUNT_AUTH_STORAGE_KEY}-user`]) localStorage.removeItem(key);
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of ['barber-customer-booking-draft', 'barber-customer-booking-receipt', 'barber-customer-booking-return', 'barber-customer-favourite-intent', 'barber-customer-email-pending', 'barber-password-proof', 'barber-customer-oauth-return']) storage.removeItem(key);
    }
    return true;
  } catch { return false; }
}
