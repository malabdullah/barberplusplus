import { test, expect, vi } from 'vitest';

test('reopening the complete link in the same tab activates it and scrubs the fragment', async () => {
  document.body.innerHTML = '<h1></h1><p id="message"></p><button id="continue" hidden></button><a id="back"></a>';
  window.history.replaceState(null, '', '/email/verify.html');
  window.__BARBER_CONFIG__ = { appUrl: window.location.origin, supabaseUrl: 'https://backend.example.test' };
  // jsdom uses HTTP; isolate the production HTTPS validation in its own tested helper.
  vi.doMock('../../public/email/verification-url.js', () => ({ verificationUrl: input => {
    if (!new URL(input).hash) throw Error('INVALID_LINK');
    return { url: 'https://backend.example.test/auth/v1/verify', type: 'recovery', customer: true };
  } }));
  await import('../../public/email/verify.js');
  expect(document.querySelector('h1').textContent).toBe('This link is incomplete');
  window.history.replaceState(null, '', '/email/verify.html#token_hash=test');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(document.querySelector('h1').textContent).toBe('Reset your password');
  expect(document.querySelector('#continue').hidden).toBe(false);
  expect(document.querySelector('#back').getAttribute('href')).toBe('/customer/sign-in');
  expect(window.location.hash).toBe('');
  expect(document.body.textContent).not.toContain('token_hash');
});
