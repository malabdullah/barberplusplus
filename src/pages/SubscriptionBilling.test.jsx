import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const { rpc, settings } = vi.hoisted(() => ({ rpc: vi.fn(), settings: { user: { id: 'manager' }, theme: 'light', language: 'en' } }));
vi.mock('../services/subscriptionBilling.service', async importOriginal => ({ ...(await importOriginal()), subscriptionRpc: rpc }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../context/AppContext', () => ({ useApp: () => settings }));
import '../i18n';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import ar from '../i18n/locales/ar.json';
import SubscriptionBilling from './SubscriptionBilling';

const business = { id: 'one', name: 'A real Test business', managerId: 'manager', managerName: 'Manager', count: 3, frequency: 'monthly', nextFrequency: null, renewalRequested: true, revision: 4, priceFils: 30000, canManage: true, access: { status: 'not_started', until: null }, shops: [], managers: [], invoices: [], history: [], grants: [] };
beforeEach(() => {
  rpc.mockReset(); settings.language = 'en'; settings.theme = 'light';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [business], hasMore: false } : action === 'detail' ? business : action === 'quote' ? { count: 3, subtotalFils: 30000, totalFils: 24000, discountFils: 6000, normalRenewalFils: 30000, discountPayments: 1 } : { saved: true }));
});
afterEach(cleanup);
const open = () => render(<MemoryRouter><SubscriptionBilling /></MemoryRouter>);
it('uses backend totals and re-reads after a saved preference', async () => {
  open();
  await screen.findByText(business.name);
  fireEvent.click(screen.getByRole('button', { name: 'Calculate estimate' }));
  await screen.findByText('KD 24.000');
  fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('preferences', expect.objectContaining({ businessId: 'one', renewalRequested: false, revision: 4, requestId: expect.any(String) })));
  await screen.findByText('Changes saved.');
});
it('keeps a failed write retry bound to the same intent', async () => {
  rpc.mockImplementation(action => action === 'preferences' ? Promise.reject(new Error('BILLING_STALE')) : Promise.resolve(action === 'businesses' ? { rows: [business] } : business));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(rpc.mock.calls.filter(([action]) => action === 'preferences')).toHaveLength(2));
  const writes = rpc.mock.calls.filter(([action]) => action === 'preferences');
  expect(writes[0][1].requestId).toBe(writes[1][1].requestId);
});
it('does not show a subscription when no business is assigned', async () => {
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [] } : business));
  open();
  await screen.findByText('No matching results.');
  expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
});


it('submits edited Admin dates and selected shops without reverting them', async () => {
  const actual = { ...business, shops: [{ id: 'shop', name: 'QA Shop' }] };
  rpc.mockImplementation(action => Promise.resolve(action === 'detail' ? actual : { saved: true }));
  render(<MemoryRouter initialEntries={['/admin/subscriptions/one']}><Routes><Route path="/admin/subscriptions/:businessId" element={<SubscriptionBilling admin/>}/></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage access' }));
  fireEvent.change(screen.getByLabelText('Access type'), { target: { value: 'manual' } });
  fireEvent.input(screen.getByLabelText('Starts on'), { target: { value: '2027-01-01' } });
  fireEvent.input(screen.getByLabelText('Ends before'), { target: { value: '2027-01-31' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'QA Shop' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Approved QA exception' } });
  expect(screen.getByLabelText('Ends before')).toHaveValue('2027-01-31');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('grant', expect.objectContaining({ businessId: 'one', kind: 'manual', startsOn: '2027-01-01', endsOn: '2027-01-31', branchIds: ['shop'], reason: 'Approved QA exception' })));
});

it('reads discount history without offering a save/payment action', async () => {
  const code = { id: 'promo', code: 'TEST20', enabled: true, kind: 'percent', value: 20, eligibility: 'monthly', payments: 1, expires_at: '2027-01-01T00:00:00Z', used: 0, redemption_limit: null };
  rpc.mockImplementation(action => Promise.resolve(action === 'codes' ? { rows: [code] } : { rows: [{ id: 1, action: 'create-code', reason: 'Approved test promotion', created_at: '2026-11-19T06:00:00Z' }] }));
  render(<MemoryRouter><SubscriptionBilling admin codesOnly/></MemoryRouter>);
  await screen.findAllByText('TEST20');
  fireEvent.click(screen.getAllByRole('button', { name: 'History' })[0]);
  await screen.findByText('Approved test promotion');
  expect(rpc).toHaveBeenCalledWith('code-history', { codeId: 'promo' });
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});


it('renders the Arabic dark screen without missing translation keys', async () => {
  const instance = i18next.createInstance();
  await instance.init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
  settings.language = 'ar'; settings.theme = 'dark';
  const { container } = render(<I18nextProvider i18n={instance}><MemoryRouter><SubscriptionBilling/></MemoryRouter></I18nextProvider>);
  await screen.findByText(business.name);
  expect(container.querySelector('.billing-foundation')).toHaveAttribute('dir', 'rtl');
  expect(container.querySelector('.billing-foundation')).toHaveAttribute('data-theme', 'dark');
  expect(container.textContent).not.toMatch(/subscriptionFoundation\.|subscriptionDesign\.|billingPreview\./);
});
