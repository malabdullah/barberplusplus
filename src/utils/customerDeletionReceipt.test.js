import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ ACCOUNT_AUTH_STORAGE_KEY: 'test-auth' }));
import { clearDeletedBrowserAccount, deletionReceipt, saveDeletionReceipt } from './customerDeletionReceipt';
const ownerId = '8c43610f-3c44-4c96-bb21-99572d110f1f'; const id = '7953c524-7f93-4f66-8b9b-9db60ca92e29';
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
describe('deletion receipt and local ownership', () => {
  it('retains only recovery fields, never identity proof or password', () => {
    saveDeletionReceipt({ id, ownerId, receipt: 'a'.repeat(43), phase: 'confirming', password: 'secret', code: '123456' });
    expect(deletionReceipt()).toMatchObject({ id, ownerId, phase: 'confirming' }); expect(sessionStorage.getItem('barber-customer-deletion')).not.toContain('secret'); expect(sessionStorage.getItem('barber-customer-deletion')).not.toContain('123456');
  });
  it('rejects malformed or expired recovery data', () => {
    sessionStorage.setItem('barber-customer-deletion', JSON.stringify({ id, ownerId, receipt: 'a'.repeat(43), savedAt: Date.now() - 8 * 86400000 })); expect(deletionReceipt()).toBeNull();
    sessionStorage.setItem('barber-customer-deletion', '{'); expect(deletionReceipt()).toBeNull();
  });
  it('preserves a different account and its drafts after a delayed deletion response', () => {
    localStorage.setItem('test-auth', JSON.stringify({ user: { id: 'other' } })); localStorage.setItem('barber-customer-booking-draft', 'new choices');
    expect(clearDeletedBrowserAccount(ownerId)).toBe(false); expect(localStorage.getItem('barber-customer-booking-draft')).toBe('new choices'); expect(localStorage.getItem('test-auth')).toContain('other');
  });
  it('removes only the deleted current account and contact drafts while keeping its receipt', () => {
    localStorage.setItem('test-auth', JSON.stringify({ user: { id: ownerId } })); localStorage.setItem('barber-customer-booking-draft', 'old contact'); localStorage.setItem('theme', 'dark'); saveDeletionReceipt({ id, ownerId, phase: 'cleanup', receipt: 'a'.repeat(43) });
    expect(clearDeletedBrowserAccount(ownerId)).toBe(true); expect(localStorage.getItem('test-auth')).toBeNull(); expect(localStorage.getItem('barber-customer-booking-draft')).toBeNull(); expect(localStorage.getItem('theme')).toBe('dark'); expect(deletionReceipt()).not.toBeNull();
  });
});
