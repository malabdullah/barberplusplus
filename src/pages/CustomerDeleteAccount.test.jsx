import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import CustomerDeleteAccount from './CustomerDeleteAccount';
const state = vi.hoisted(() => ({ request: vi.fn(), clear: vi.fn(), connect: vi.fn(), saved: null, callback: null }));
const owner = '8c43610f-3c44-4c96-bb21-99572d110f1f';
vi.mock('../services/customerDeletion.service', () => ({ deletionRequest: (...args) => state.request(...args) }));
vi.mock('../services/customerAppleDeletion.service', () => ({ connectAppleForDeletion: (...args) => state.connect(...args) }));
vi.mock('../utils/customerDeletionReceipt', () => ({ deletionReceipt: () => state.saved, saveDeletionReceipt: value => { state.saved = value; }, clearDeletedBrowserAccount: (...args) => state.clear(...args) }));
vi.mock('../lib/customerSupabase', () => ({ customerSupabase: { auth: { getSession: async () => ({ data: { session: { user: { id: '8c43610f-3c44-4c96-bb21-99572d110f1f' } } } }), onAuthStateChange: callback => { state.callback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
vi.mock('../components/Public/PublicNavigationContext', () => ({ usePublicNavigationBusy: () => {} }));
let i18n;
const preview = { methods: ['email_code'], providers: ['apple'], appleRevocation: 'registered', destination: 'q***@example.test', digest: 'a'.repeat(64), upcoming: [], upcomingCount: 0 };
beforeEach(async () => {
  vi.resetAllMocks(); state.saved = null; state.callback = null; state.clear.mockReturnValue(false);
  state.request.mockImplementation(async action => action === 'preview' ? preview : action === 'start' ? { state: 'awaiting_code', receipt: 'b'.repeat(43), ...preview } : { state: 'verified' });
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);
const mount = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerDeleteAccount /></MemoryRouter></I18nextProvider>);
async function prove() {
  fireEvent.click(await screen.findByRole('button', { name: en.customerDeletion.continue }));
  fireEvent.change(await screen.findByLabelText(en.customerDeletion.code), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.verify }));
  await screen.findByRole('checkbox');
}
it('requires proof and explicit cancellation consent before confirming', async () => {
  mount(); await screen.findByText(en.customerDeletion.future_zero);
  expect(screen.getByText('Connected sign-in: Apple.')).toBeVisible();
  await prove(); const button = screen.getByRole('button', { name: en.customerDeletion.delete }); expect(button).toBeDisabled();
  expect(state.request.mock.calls.some(([action]) => action === 'confirm')).toBe(false);
  fireEvent.click(screen.getByRole('checkbox')); expect(button).toBeEnabled(); expect(state.saved).toMatchObject({ ownerId: owner, phase: 'proof' });
});
it('changed appointments require a new explicit confirmation', async () => {
  mount(); await prove(); state.request.mockImplementation(async action => action === 'confirm' ? { ...preview, state: 'review_required', upcomingCount: 1, digest: 'c'.repeat(64) } : preview);
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.delete }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.customerDeletion.errors.REVIEW_REQUIRED);
  expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('button', { name: en.customerDeletion.delete })).toBeDisabled(); expect(state.clear).not.toHaveBeenCalled();
});
it('recovers a lost confirmation response with the same saved receipt', async () => {
  mount(); await prove(); state.request.mockImplementation(async action => { if (action === 'confirm') throw Error('network lost'); return { state: 'cleanup_pending' }; });
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.delete }));
  await screen.findByText(en.customerDeletion.pending); expect(state.saved.phase).toBe('cleanup');
  expect(state.request.mock.calls.filter(([action]) => action === 'start')).toHaveLength(1);
  expect(state.request).toHaveBeenCalledWith('status', { id: state.saved.id, receipt: state.saved.receipt });
});
it('does not apply a delayed start response after switching accounts', async () => {
  let resolve; mount(); await screen.findByRole('button', { name: en.customerDeletion.continue });
  state.request.mockImplementation(() => new Promise(value => { resolve = value; }));
  fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.continue }));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  state.callback('SIGNED_IN', { user: { id: 'another-account' } }); resolve({ ...preview, receipt: 'b'.repeat(43) });
  expect(await screen.findByText(en.customerDeletion.switched)).toBeVisible(); expect(state.clear).not.toHaveBeenCalled(); expect(state.saved.receipt).toBeUndefined();
});

it('uses the final provider result instead of keeping a stale manual-revocation warning', async () => {
  state.saved = { id: owner, ownerId: owner, receipt: 'b'.repeat(43), phase: 'cleanup', appleManualRevocation: true };
  state.request.mockResolvedValue({ state: 'complete', appleManualRevocation: false, appleRevocation: 'revoked' });
  mount(); await screen.findByText(en.customerDeletion.complete);
  expect(screen.queryByText(en.customerDeletion.appleHelp, { exact: false })).not.toBeInTheDocument();
  expect(state.saved.appleManualRevocation).toBe(false);
});

const legacy = { ...preview, appleRevocation: 'manual_required' };
function legacyRequests() {
  state.request.mockImplementation(async action => action === 'preview' ? legacy : action === 'start' ? { state: 'awaiting_code', receipt: 'b'.repeat(43), ...legacy } : { state: 'verified' });
}
it('lets a legacy Apple customer initiate deletion and explicitly continue without reconnecting', async () => {
  legacyRequests(); mount(); await prove();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.appleSkip }));
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: en.customerDeletion.delete })).toBeEnabled();
  expect(state.connect).not.toHaveBeenCalled();
});
it.each(['APPLE_CANCELLED', 'APPLE_POPUP_BLOCKED', 'APPLE_NOT_AVAILABLE', 'APPLE_TIMEOUT', 'APPLE_PROOF_INVALID', 'APPLE_TOKEN_UNAVAILABLE'])('keeps deletion usable after %s without starting or confirming a job', async failure => {
  legacyRequests(); state.connect.mockRejectedValue(Error(failure)); mount();
  fireEvent.click(await screen.findByRole('button', { name: en.customerDeletion.appleConnect }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.customerDeletion.errors[failure]);
  expect(state.request.mock.calls.map(([action]) => action)).toEqual(['preview']);
  fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.appleSkip }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: en.customerDeletion.continue })).toBeEnabled();
});
it('refreshes bookings and requires renewed explicit confirmation after successful reconnection', async () => {
  legacyRequests(); mount(); await prove();
  state.connect.mockResolvedValue({ registered: true });
  state.request.mockResolvedValue({ ...preview, digest: 'c'.repeat(64), upcomingCount: 1 });
  fireEvent.click(screen.getByRole('button', { name: en.customerDeletion.appleConnect }));
  await waitFor(() => expect(screen.queryByRole('button', { name: en.customerDeletion.appleConnect })).not.toBeInTheDocument());
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: en.customerDeletion.delete })).toBeDisabled();
  expect(screen.getByText(en.customerDeletion.future_one)).toBeVisible();
  expect(state.request.mock.calls.filter(([action]) => action === 'confirm')).toHaveLength(0);
});
it('shows clear manual instructions only when the final server result requires them', async () => {
  state.saved = { id: owner, ownerId: owner, receipt: 'b'.repeat(43), phase: 'cleanup' };
  state.request.mockResolvedValue({ state: 'complete', appleManualRevocation: true, appleRevocation: 'manual_required' });
  mount(); expect(await screen.findByText(en.customerDeletion.appleHelp)).toBeVisible();
  expect(screen.getByRole('link', { name: en.customerDeletion.appleSettings })).toHaveAttribute('href', 'https://account.apple.com');
});
