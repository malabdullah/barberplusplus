import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import AccountTools from './AccountTools';
import ContactSupport from './ContactSupport';
const state = vi.hoisted(() => ({ access: null, sessions: vi.fn(), activity: vi.fn(), revokeSession: vi.fn() }));
vi.mock('../hooks/useAccountAccess', () => ({ default: () => state.access }));
vi.mock('../services/accountTools.service', () => ({ accountToolsService: state }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } } }));
let i18n;
const row = (id, current = false) => ({ id, device: 'iPhone Safari', lastActiveAt: '2026-11-12T04:00:00Z', current });
beforeEach(async () => {
  vi.resetAllMocks();
  state.access = { identity: { role: 'manager' }, session: { access_token: 'manager-token' }, retry: vi.fn(), loading: false, error: '' };
  state.sessions.mockResolvedValue({ currentSession: row('here', true), rows: [row('other')], nextCursor: { id: 'next', createdAt: '2026-11-12T04:00:00Z' } });
  state.activity.mockResolvedValue({ rows: [], nextCursor: null });
  state.revokeSession.mockResolvedValue({ revoked: true });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);
function mount(component) { return render(<I18nextProvider i18n={i18n}><MemoryRouter><Routes><Route path="/" element={component} /><Route path="/customer/sign-in" element={<p>Sign in destination</p>} /></Routes></MemoryRouter></I18nextProvider>); }
it('pins current session, paginates other devices, and requires confirmation before revocation', async () => {
  mount(<AccountTools view="sessions" />);
  expect(await screen.findByText(en.accountTools.thisDevice)).toBeVisible();
  expect(screen.getAllByRole('button', { name: en.accountTools.endSession })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: en.accountTools.loadMore }));
  await waitFor(() => expect(state.sessions).toHaveBeenLastCalledWith({ id: 'next', createdAt: '2026-11-12T04:00:00Z' }, 'manager-token'));
  // The server's second page is supplied separately for a clean refresh.
  state.sessions.mockResolvedValue({ currentSession: row('here', true), rows: [row('other')], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: en.common.refresh }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: en.accountTools.endSession })).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: en.accountTools.endSession }));
  expect(state.revokeSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: en.accountTools.endSession }).at(-1));
  expect(await screen.findByRole('status')).toHaveTextContent(en.accountTools.sessionEnded);
  expect(state.revokeSession).toHaveBeenCalledWith('other', 'manager-token');
  expect(screen.getByText(en.accountTools.thisDevice)).toBeVisible();
});
it('requests the customer activity scope even for a manager in customer mode', async () => {
  mount(<AccountTools view="activity" customer />);
  await screen.findByText(en.accountTools.noActivity);
  expect(state.activity).toHaveBeenCalledWith('customer', null, 'manager-token');
  expect(screen.getByRole('link', { name: en.common.back })).toHaveAttribute('href', '/customer/account');
});
it('keeps support details hidden from guests and shows a signed-in email action in Arabic', async () => {
  state.access = { identity: null, session: null, loading: false, retry: vi.fn(), error: '' };
  const page = mount(<ContactSupport />); await screen.findByText('Sign in destination');
  expect(screen.queryByText('support@barberplusplus.com')).not.toBeInTheDocument();page.unmount();
  state.access = { identity: { role: 'barber' }, session: { access_token: 'barber-token' }, loading: false };
  await i18n.changeLanguage('ar'); mount(<ContactSupport />);
  expect(screen.getByRole('link', { name: ar.support.email })).toHaveAttribute('href', 'mailto:support@barberplusplus.com');
  expect(screen.getByRole('link', { name: ar.common.back })).toHaveAttribute('href', '/barber/settings');
});
it('does not expose support for an expired session or a failed identity check', () => {
  state.access = { identity: null, session: { access_token: 'expired' }, loading: false, error: 'AUTH_REQUIRED', retry: vi.fn() };
  mount(<ContactSupport />);
  expect(screen.getByRole('alert')).toHaveTextContent(en.accountTools.sessionExpired);
  expect(screen.queryByText('support@barberplusplus.com')).not.toBeInTheDocument();
});
