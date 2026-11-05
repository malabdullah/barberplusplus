import { beforeEach, expect, it } from 'vitest';
import { ACCOUNT_NOTICE_KEY, LEGACY_CUSTOMER_KEY, customerCapable, migrateAccountSession, workDestination } from './accountSession';
beforeEach(() => localStorage.clear());
const session = id => JSON.stringify({ user: { id }, access_token: 'access', refresh_token: 'refresh' });
it('migrates the existing customer login and in-flight PKCE verifier when no shared account is active', () => {
  localStorage.setItem(LEGACY_CUSTOMER_KEY, session('customer'));
  localStorage.setItem(`${LEGACY_CUSTOMER_KEY}-code-verifier`, 'verifier');
  migrateAccountSession(localStorage, 'shared');
  expect(localStorage.getItem('shared')).toBe(session('customer'));
  expect(localStorage.getItem('shared-code-verifier')).toBe('verifier');
  expect(localStorage.getItem(LEGACY_CUSTOMER_KEY)).toBeNull();
});
it('retains the active work identity and explains the legacy second account without merging it', () => {
  localStorage.setItem('shared', session('manager'));
  localStorage.setItem(LEGACY_CUSTOMER_KEY, session('customer'));
  migrateAccountSession(localStorage, 'shared');
  expect(localStorage.getItem('shared')).toBe(session('manager'));
  expect(localStorage.getItem(ACCOUNT_NOTICE_KEY)).toBe('1');
});
it('does not create work access for a customer or enroll protected admin/agent into customer mode', () => {
  expect(workDestination('customer')).toBeUndefined();
  expect(workDestination('barber')).toBe('/barber');
  expect(customerCapable('manager')).toBe(true);
  expect(customerCapable('admin')).toBe(false);
  expect(customerCapable('agent')).toBe(false);
});

it('preserves an in-flight first customer sign-in without an existing session', () => {
  localStorage.setItem(`${LEGACY_CUSTOMER_KEY}-code-verifier`, 'pending-verifier');
  migrateAccountSession(localStorage, 'shared');
  expect(localStorage.getItem('shared-code-verifier')).toBe('pending-verifier');
  expect(localStorage.getItem(`${LEGACY_CUSTOMER_KEY}-code-verifier`)).toBeNull();
  expect(localStorage.getItem('shared')).toBeNull();
});
it('keeps the current shared sign-in verifier when an older redirect also exists', () => {
  localStorage.setItem(`${LEGACY_CUSTOMER_KEY}-code-verifier`, 'older-verifier');
  localStorage.setItem('shared-code-verifier', 'current-verifier');
  migrateAccountSession(localStorage, 'shared');
  expect(localStorage.getItem('shared-code-verifier')).toBe('current-verifier');
});
