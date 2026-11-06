const key = 'barber-password-proof';
export function rememberPasswordProof(value, signInPath = '/customer/sign-in') {
  if (!value.proof) return;
  try { sessionStorage.setItem(key, JSON.stringify({ proof: value.proof, expiresAt: Date.now() + Number(value.expiresIn || 300) * 1000, signInPath: signInPath === '/login' ? '/login' : '/customer/sign-in' })); } catch { /* The caller can retain route state. */ }
}
export function passwordProof() {
  try { const value = JSON.parse(sessionStorage.getItem(key)); return value?.expiresAt > Date.now() && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.proof || '') ? value : null; } catch { return null; }
}
export function forgetPasswordProof() {
  try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}
