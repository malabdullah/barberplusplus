import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verificationUrl } from '../public/email/verification-url.js';
const appUrl = 'https://app.example.test';
const config = { appUrl, supabaseUrl: 'https://backend.example.test' };
const token = 'a'.repeat(56);
function link(type = 'recovery', target = `${appUrl}/customer/email-callback?next=book`) {
  const url = new URL('/email/verify.html', appUrl);
  url.hash = new URLSearchParams({ type, token_hash: token, redirect_to: target }).toString();
  return url.href;
}
test('preserves customer booking continuation, exact token and recovery type', () => {
  const result = verificationUrl(link(), config);
  const url = new URL(result.url);
  assert.equal(result.customer, true);
  assert.equal(url.origin, config.supabaseUrl);
  assert.equal(url.pathname, '/auth/v1/verify');
  assert.equal(url.searchParams.get('token'), token);
  assert.equal(url.searchParams.get('redirect_to'), `${appUrl}/customer/email-callback?next=book`);
});
test('preserves staff password recovery and all supported authentication types', () => {
  for (const type of ['signup', 'recovery', 'magiclink', 'invite', 'email_change']) {
    const result = verificationUrl(link(type, `${appUrl}/reset-password`), config);
    assert.equal(result.customer, false);
    assert.equal(new URL(result.url).searchParams.get('type'), type);
  }
});
test('rejects forged destinations, unsafe protocols and unknown return parameters', () => {
  for (const target of ['https://evil.example/reset-password', `https://attacker@${new URL(appUrl).host}/reset-password`, `${appUrl}/customer/email-callback?next=https://evil.example`, `${appUrl}/reset-password?redirect=https://evil.example`, `${appUrl}/untrusted`, `${appUrl}/reset-password#secret`, 'javascript:alert(1)']) {
    assert.throws(() => verificationUrl(link('recovery', target), config), /INVALID_LINK/);
  }
  assert.throws(() => verificationUrl(link('unknown'), config));
  assert.throws(() => verificationUrl(link().replace(token, 'bad-token'), config));
  assert.throws(() => verificationUrl(link().replace(appUrl, 'https://another.example'), config));
  assert.throws(() => verificationUrl(link(), { ...config, supabaseUrl: 'http://backend.example.test' }));
  assert.throws(() => verificationUrl(link(), { ...config, supabaseUrl: 'https://key:password@backend.example.test' }));
});
test('keeps template credentials in fragments and preserves native/unknown callbacks', async () => {
  for (const flow of ['confirmation', 'recovery', 'email_change', 'magic_link', 'invite']) {
    const html = await readFile(new URL(`../public/email/templates/${flow}.html`, import.meta.url), 'utf8');
    assert.match(html, /verify\.html#token_hash=/);
    assert.doesNotMatch(html, /verify\.html\?token_hash=/);
    assert.match(html, /\.RedirectTo \| urlquery/);
    assert.match(html, /else }}{{ \.ConfirmationURL }}/);
    assert.match(html, /{{ \.Token }}/);
    assert.match(html, /support@barberplusplus\.com/);
  }
});
