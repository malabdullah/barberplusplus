const key = 'barber-customer-email-pending';
export const emailDestination = value => value === '/book' ? '/book' : '/customer/account';
export function pendingEmail() {
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    return value && ['signup', 'recovery'].includes(value.purpose) && typeof value.email === 'string' ? value : null;
  } catch { return null; }
}
export function rememberEmail({ email, purpose, returnTo }) {
  // Only the address and navigation context survive a refresh, never passwords or codes.
  try { sessionStorage.setItem(key, JSON.stringify({ email: email.trim().toLowerCase(), purpose, returnTo: emailDestination(returnTo), sentAt: Date.now() })); } catch { /* The route state still supports browsers with storage disabled. */ }
}
export function forgetEmail() {
  try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable in private browsers. */ }
}
