import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verificationUrl } from '../public/email/verification-url.js';
const appUrl = 'https://app.example.test';
const config = { appUrl, supabaseUrl: 'https://backend.example.test' };
const token = 'a'.repeat(56);
const request = 'af220000-0000-4000-8000-000000000003';
function link(type = 'recovery', target = `${appUrl}/customer/email-callback?next=book&request_id=${request}`) {
  const url = new URL('/email/verify.html', appUrl);
  url.hash = new URLSearchParams({ type, token_hash: token, redirect_to: target }).toString();
  return url.href;
}
test('passes recovery to the own-site server proof flow without consuming its credential', () => {
  const result = verificationUrl(link(), config); const url = new URL(result.url);
  assert.equal(result.customer, true); assert.equal(url.origin, appUrl);
  assert.equal(url.pathname, '/customer/email-callback');
  assert.equal(url.searchParams.get('request_id'), request);
  assert.equal(url.searchParams.get('next'), 'book');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token_hash'), token);
  assert.ok(!url.searchParams.has('token_hash'));
});
test('keeps password invitations unconsumed while other supported mail flows use Auth', () => {
  for (const type of ['signup', 'magiclink', 'email_change']) {
    const url = new URL(verificationUrl(link(type, `${appUrl}/reset-password`), config).url);
    assert.equal(url.origin, config.supabaseUrl); assert.equal(url.searchParams.get('type'), type);
  }
  const invite = new URL(verificationUrl(link('invite', `${appUrl}/accept-invite`), config).url);
  assert.equal(invite.origin, appUrl); assert.equal(invite.pathname, '/accept-invite');
  assert.equal(new URLSearchParams(invite.hash.slice(1)).get('type'), 'invite');
});
test('preserves only validated native state and recovery request binding', () => {
  const target = `${appUrl}/customer/email-callback?client=ios&state=${request}&request_id=${request}`;
  assert.equal(new URL(verificationUrl(link('recovery',target),config).url).search, new URL(target).search);
  assert.throws(()=>verificationUrl(link('recovery',target.replace(request,'bad')),config));
});
test('rejects forged destinations, unsafe protocols and unknown return parameters', () => {
  for (const target of ['https://evil.example/reset-password', `https://attacker@${new URL(appUrl).host}/reset-password`, `${appUrl}/customer/email-callback?next=https://evil.example`, `${appUrl}/customer/email-callback?client=android`, `${appUrl}/reset-password?redirect=https://evil.example`, `${appUrl}/untrusted`, `${appUrl}/reset-password#secret`, 'javascript:alert(1)']) {
    assert.throws(() => verificationUrl(link('recovery', target), config), /INVALID_LINK/);
  }
  assert.throws(() => verificationUrl(link('unknown'), config));
  assert.throws(() => verificationUrl(link().replace(token, 'bad-token'), config));
  assert.throws(() => verificationUrl(link().replace(appUrl, 'https://another.example'), config));
  assert.throws(() => verificationUrl(link(), { ...config, supabaseUrl: 'http://backend.example.test' }));
  assert.throws(() => verificationUrl(link(), { ...config, supabaseUrl: 'https://key:password@backend.example.test' }));
});
test('keeps template credentials in fragments, including dynamic and native callbacks', async () => {
  for (const flow of ['confirmation', 'recovery', 'email_change', 'magic_link', 'invite']) {
    const html = await readFile(new URL(`../public/email/templates/${flow}.html`, import.meta.url), 'utf8');
    assert.match(html, /verify\.html#token_hash=/); assert.doesNotMatch(html, /verify\.html\?token_hash=/);
    assert.match(html, /\.RedirectTo \| urlquery/); assert.match(html, /{{ \.Token }}/);
    assert.match(html, /support@barberplusplus\.com/);
    if(flow!=='email_change') assert.doesNotMatch(html,/else }}{{ \.ConfirmationURL }}/);
  }
});
