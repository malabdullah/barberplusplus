import { expect, it } from 'vitest';
import { staffMfaReturn } from './staffMfaReturn';

it('preserves the password recovery route and booking intent', () => {
  expect(staffMfaReturn('/customer/reset-password')).toBe('/customer/reset-password');
  expect(staffMfaReturn('/customer/verify-email?purpose=recovery')).toBe('/customer/reset-password');
  expect(staffMfaReturn('/customer/sign-in?next=book')).toBe('/book');
  expect(staffMfaReturn('/customer/auth-callback?code=consumed&next=book')).toBe('/book');
  expect(staffMfaReturn('/customer/auth-callback?code=consumed', '/book')).toBe('/book');
});
it('rejects external destinations and MFA loops', () => {
  for (const path of ['https://other.example/', '//other.example', '/\\other.example', '/mfa-setup']) {
    expect(staffMfaReturn(path)).toBe('/customer/account');
  }
});
