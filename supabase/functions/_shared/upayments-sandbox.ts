const apiBase = 'https://sandboxapi.upayments.com/api/v1/';
const encoder = new TextEncoder();

async function signedDigest(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {
    name: 'HMAC', hash: 'SHA-256',
  }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function sign(secret: string, value: string) {
  return btoa(String.fromCharCode(...await signedDigest(secret, value)));
}

export async function authorizedWebhook(req: Request, raw: string, secret: string, notificationUrl: string) {
  const stamp = req.headers.get('x-timestamp') || '';
  const signature = req.headers.get('x-signature') || '';
  if (!/^\d{10}$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 300
    || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = atob(signature);
  const expected = await signedDigest(secret, stamp + 'POST' + notificationUrl + raw);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual.charCodeAt(i);
  return difference === 0;
}

export function fils(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = String(value).match(/^(\d{1,9})(?:\.(\d{1,3}))?$/);
  return match ? Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0')) : null;
}

export function sandboxRequester(config: { token: string; secret: string; fetcher?: typeof fetch }) {
  return async (method: string, path: string, raw = '') => {
    const stamp = String(Math.floor(Date.now() / 1000));
    const result = await (config.fetcher || fetch)(apiBase + path, {
      method, body: raw || undefined, redirect: 'error', signal: AbortSignal.timeout(9000),
      headers: {
        Authorization: 'Bearer ' + config.token, Accept: 'application/json',
        'Content-Type': 'application/json', 'X-Timestamp': stamp,
        'X-Signature': await sign(config.secret, stamp + method + path + raw),
      },
    });
    return { http: result.status, body: await result.json().catch(() => null) };
  };
}

export async function bodyText(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let amount = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      amount += value.byteLength;
      if (amount > 8192) throw new Error('UPAYMENTS_INVALID');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
