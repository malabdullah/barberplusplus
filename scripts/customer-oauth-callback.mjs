import http from 'node:http';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerOAuthEnv } from './customer-oauth-config.mjs';

const callbackPath = '/auth/v1/callback';
const upstream = 'http://127.0.0.1:55321';
const bodyLimit = 32768;

// A callback-only boundary in front of the isolated local Test Auth service.
// No credentials, arbitrary upstream URLs, customer API routes or request logs.
export function createCustomerCallbackServer({ hostname, request = fetch }) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(hostname)) throw Error('Invalid callback hostname');
  return http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reject = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    if (![hostname, `${hostname}:443`].includes(req.headers.host)) return reject(404, 'Not found');
    if (!req.url || !/^\/auth\/v1\/callback(?:\?|$)/.test(req.url) || req.url.length > 16384) return reject(404, 'Not found');
    const url = new URL(req.url, `https://${hostname}`);
    if (url.pathname !== callbackPath) return reject(404, 'Not found');
    if (!['GET', 'POST'].includes(req.method)) return reject(405, 'Method not allowed');
    if (req.method === 'POST' && req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return reject(415, 'Expected form response');
    if (req.headers.origin && req.headers.origin !== 'https://appleid.apple.com') return reject(403, 'Unexpected response origin');
    if (Number(req.headers['content-length']) > bodyLimit) return reject(413, 'Response too large');
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > bodyLimit) { reject(413, 'Response too large'); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const fields = req.method === 'POST' ? new URLSearchParams(body) : url.searchParams;
      if (fields.getAll('state').length !== 1 || !fields.get('state') || !(fields.get('code') || fields.get('error'))) return reject(400, 'Invalid provider response');
      const result = await request(`${upstream}${callbackPath}${url.search}`, {
        method: req.method,
        headers: {
          ...(req.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          'X-Forwarded-Host': hostname,
          'X-Forwarded-Proto': 'https',
        },
        ...(req.method === 'POST' ? { body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if ([302, 303].includes(result.status)) {
        const destination = new URL(result.headers.get('location'));
        if (!['http://localhost:5173', 'http://127.0.0.1:5173'].includes(destination.origin) || !['/', '/customer/auth-callback'].includes(destination.pathname) || destination.username || destination.password) return reject(502, 'Unexpected Auth redirect');
        res.writeHead(result.status, { Location: destination.href });
        res.end();
      } else reject(result.status >= 400 && result.status < 500 ? 400 : 502, 'Sign-in response could not be completed. Return to Test and try again.');
      await result.body?.cancel();
    } catch {
      if (!res.headersSent) reject(502, 'Test authentication is unavailable. Return to Test and try again.');
      else res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const path = resolve(root, '.local-test/customer-oauth.json');
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || realpathSync(root) !== root) throw Error('Expected private local Test configuration');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  customerOAuthEnv(config);
  if (!config.apple) throw Error('Apple Test configuration is required');
  const server = createCustomerCallbackServer({ hostname: new URL(config.apple.redirectUri).hostname });
  server.listen(55329, '127.0.0.1', () => console.log('Local Test callback relay listening on loopback port 55329'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
