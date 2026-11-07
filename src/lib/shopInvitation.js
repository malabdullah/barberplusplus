const KEY = 'barber-shop-invitation';
const valid = value => /^[0-9a-f-]{36}$/i.test(value?.id || '') && /^[0-9a-f]{64}$/.test(value?.token || '');
export function readShopInvitation() {
  const url = new URL(window.location.href);
  const value = { id: url.searchParams.get('invitation'), token: new URLSearchParams(url.hash.slice(1)).get('token') };
  if (valid(value)) return value;
  try { const saved = JSON.parse(sessionStorage.getItem(KEY)); if (valid(saved)) return saved; } catch { /* Optional storage. */ }
  return null;
}
export function rememberShopInvitation(value) {
  if (valid(value)) try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* The original URL remains resumable. */ }
}
export function clearShopInvitation() { try { sessionStorage.removeItem(KEY); } catch { /* Optional storage. */ } }
export function hasShopInvitation() {
  const url = new URL(window.location.href);
  return url.searchParams.has('invitation') || Boolean(readShopInvitation()) && !new URLSearchParams(url.hash.slice(1)).has('token_hash');
}
