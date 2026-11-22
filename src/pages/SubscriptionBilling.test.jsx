import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const { rpc, downloadPdf, settings } = vi.hoisted(() => ({ rpc: vi.fn(), downloadPdf: vi.fn(), settings: { user: { id: 'manager' }, theme: 'light', language: 'en' } }));
vi.mock('../services/subscriptionBilling.service', async importOriginal => ({ ...(await importOriginal()), subscriptionRpc: rpc }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: {
  environment: 'cloud-test',
  cloudTestProjectRef: 'qvkucvcjmojjbphlzlks',
  appUrl: 'https://barber-test.alabdullah-cs.workers.dev',
} }));
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) },
} }));
vi.mock('../utils/subscriptionInvoicePdf', () => ({ downloadSubscriptionInvoice: downloadPdf }));
vi.mock('../context/AppContext', () => ({ useApp: () => settings }));
import '../i18n';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import ar from '../i18n/locales/ar.json';
import SubscriptionBilling from './SubscriptionBilling';

const business = { id: 'one', name: 'A real Test business', managerId: 'manager', managerName: 'Manager', count: 3, frequency: 'monthly', nextFrequency: null, renewalRequested: true, revision: 4, priceFils: 30000, canManage: true, access: { status: 'not_started', until: null }, shops: [], managers: [], invoices: [], history: [], grants: [] };
beforeEach(() => {
  downloadPdf.mockReset();
  rpc.mockReset(); settings.language = 'en'; settings.theme = 'light';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ eligible: false })));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [business], hasMore: false } : action === 'detail' ? business : action === 'quote' ? { count: 3, subtotalFils: 30000, totalFils: 24000, discountFils: 6000, normalRenewalFils: 30000, discountPayments: 1 } : { saved: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = () => render(<MemoryRouter><SubscriptionBilling /></MemoryRouter>);
it('shows a twelve-payment monthly discount with its correct duration and amount', async () => {
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [business] } : action === 'detail' ? business : { count: 3, subtotalFils: 30000, totalFils: 15000, discountFils: 15000, normalRenewalFils: 30000, discountPayments: 12 }));
  open(); await screen.findByText(business.name);
  fireEvent.click(screen.getByText('Pricing calculator', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Calculate estimate' }));
  await screen.findByText('First 12 monthly payments');
  expect(screen.getAllByText('KD 15.000')).toHaveLength(2);
});
it('uses backend totals and re-reads after a saved preference', async () => {
  open();
  await screen.findByText(business.name);
  fireEvent.click(screen.getByText('Pricing calculator', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Calculate estimate' }));
  await screen.findByText('KD 24.000');
  fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('preferences', expect.objectContaining({ businessId: 'one', renewalRequested: false, revision: 4, requestId: expect.any(String) })));
  await screen.findByText('Changes saved.');
});
it('replaces the checkout after a billing refresh and quotes the edited discount code', async () => {
  fetch.mockImplementation(async (_url, options) => {
    const { action, code } = JSON.parse(options.body);
    if (action === 'read') return Response.json({ eligible: true });
    return Response.json({ subtotalFils: 30000, discountFils: code === 'TEST25' ? 7500 : 0, totalFils: code === 'TEST25' ? 22500 : 30000 });
  });
  open();
  const originalCheckout = await screen.findByRole('region', { name: 'UPayments checkout' });
  const billingRpc = rpc.getMockImplementation();
  let finishRefresh;
  const refreshRead = new Promise(resolve => { finishRefresh = resolve; });
  rpc.mockImplementation((action, data) => action === 'detail' ? refreshRead : billingRpc(action, data));
  fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(rpc.mock.calls.filter(([action]) => action === 'detail')).toHaveLength(2));
  expect(originalCheckout).not.toBeInTheDocument();
  finishRefresh(business);
  const checkout = within(await screen.findByRole('region', { name: 'UPayments checkout' }));
  const field = checkout.getByRole('textbox', { name: 'Discount code' });
  fireEvent.change(field, { target: { value: 'TEST25' } });
  expect(field).toHaveValue('TEST25');
  fireEvent.click(checkout.getByRole('button', { name: 'Review total' }));
  await checkout.findByText('KD 22.500');
  fireEvent.change(field, { target: { value: '' } });
  expect(field).toHaveValue('');
  expect(checkout.queryByText('KD 22.500')).toBeNull();
});

it('downloads the original recorded invoice amounts from Billing', async () => {
  const invoice = { id: 'invoice-paid', state: 'paid', currency: 'KWD', subtotal_fils: 30000, discount_fils: 7500,
    total_fils: 22500, created_at: '2026-11-22T14:00:00Z', period_starts_at: '2026-11-22T14:00:00Z',
    period_ends_at: '2026-12-22T14:00:00Z' };
  const actual = { ...business, invoices: [invoice], priceFils: 50000 };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [actual] } : actual));
  open();
  fireEvent.click(await screen.findByText('Invoices', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(downloadPdf).toHaveBeenCalledWith(expect.objectContaining({
    businessName: actual.name, invoice, language: 'en',
  })));
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


it('opens discount codes from a populated subscription list without reusing its rows', async () => {
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [business] } : { rows: [] }));
  render(<MemoryRouter initialEntries={['/admin/subscriptions']}><Routes>
    <Route path="/admin/subscriptions" element={<SubscriptionBilling admin/>}/>
    <Route path="/admin/subscriptions/discounts" element={<SubscriptionBilling key="admin-discount-codes" admin codesOnly/>}/>
  </Routes></MemoryRouter>);
  await screen.findAllByText(business.name);
  fireEvent.click(screen.getByRole('link', { name: 'Discount codes' }));
  await screen.findByRole('heading', { name: 'Discount codes' });
  await screen.findByText('No matching results.');
  expect(rpc).toHaveBeenCalledWith('codes', expect.any(Object));
});

it.each([false, true])('separates the Kuwait billing and complimentary expiry dates for admin=%s', async admin => {
  const actual = { ...business, periodEndsAt: '2026-12-19T22:05:45Z',
    access: { status: 'active', until: '2026-12-19T22:05:45Z' },
    complimentaryAccess: [{ startsAt: '2026-11-19T21:00:00Z', expiresAt: '2099-11-18T21:00:00Z' }],
    grants: admin ? [{ id: 'full-grant', kind: 'full', starts_at: '2026-11-19T21:00:00Z', ends_at: '2099-11-18T21:00:00Z', branch_ids: [] }] : [],
  };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [actual] } : actual));
  render(<MemoryRouter initialEntries={['/admin/subscriptions/one']}><Routes><Route path="/admin/subscriptions/:businessId" element={<SubscriptionBilling admin={admin}/>}/></Routes></MemoryRouter>);
  const summary = within(await screen.findByRole('region', { name: 'Current subscription' }));
  expect(summary.getByText('Billing period ends').nextElementSibling).toHaveTextContent('20 Dec 2026');
  expect(summary.getByText('Complimentary access expires').nextElementSibling).toHaveTextContent('19 Nov 2099');
  expect(summary.queryByText('Renewal / expiry')).toBeNull();
  expect(rpc.mock.calls.every(([action]) => ['businesses', 'detail'].includes(action))).toBe(true);
});

it('renders the new date labels in Arabic dark mode', async () => {
  const instance = i18next.createInstance();
  await instance.init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
  settings.language = 'ar'; settings.theme = 'dark';
  const actual = { ...business, periodEndsAt: '2026-12-19T22:05:45Z', grants: [{ kind: 'full', starts_at: '2026-11-19T21:00:00Z', ends_at: '2099-11-18T21:00:00Z' }],
    access: { status: 'active', enforced: true }, paidCapacity: 3,
    capacity: { allowed: false, reason: 'BILLING_CAPACITY_REQUIRED', additionalFils: 4995 } };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [actual] } : actual));
  render(<I18nextProvider i18n={instance}><MemoryRouter><SubscriptionBilling/></MemoryRouter></I18nextProvider>);
  const label = await screen.findByText(ar.subscriptionDesign.complimentaryAccessExpires);
  expect(label.nextElementSibling.querySelector('time')).toHaveAttribute('dateTime', '2099-11-18T21:00:00Z');
  expect(screen.getByText(ar.subscriptionDesign.billingPeriodEnds)).toBeVisible();
  expect(screen.getByText(ar.subscriptionEnforcement.addBarberToday).nextElementSibling).toHaveTextContent('4.995');
});

it('shows one concise manager row with the server-provided cost for one active barber today', async () => {
  const actual = { ...business, access: { status: 'active', enforced: true }, paidCapacity: 3,
    capacity: { allowed: false, reason: 'BILLING_CAPACITY_REQUIRED', additionalFils: 5000 } };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [actual] } : actual));
  open();
  await screen.findByText('Add one active barber today');
  expect(screen.getByText('KD 5.000')).toBeVisible();
  expect(screen.queryByText('Paid barber places')).toBeNull();
  expect(screen.queryByText('Additional amount this period')).toBeNull();
  expect(screen.queryByText(/This barber needs an additional paid place/)).toBeNull();
  expect(screen.queryByRole('button', { name: /pay|settle/i })).toBeNull();
});

it.each([
  [{ allowed: true, additionalFils: 0 }, 'KD 0.000'],
  [{ allowed: false, reason: 'BILLING_RENEW_REQUIRED', additionalFils: 0 }, 'Renew subscription first'],
  [{ allowed: false, reason: 'BILLING_ACCESS_REQUIRED', additionalFils: 0 }, 'Subscription required'],
  [{ allowed: false, reason: 'BILLING_CAPACITY_REQUIRED' }, 'Not available'],
])('does not present a blocked or missing quote as a free barber place (%j)', async (capacity, expected) => {
  const actual = { ...business, access: { status: 'active', enforced: true }, paidCapacity: 3, capacity };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [actual] } : actual));
  open();
  const label = await screen.findByText('Add one active barber today');
  expect(label.nextElementSibling).toHaveTextContent(expected);
});

it('preserves the Admin capacity details', async () => {
  const actual = { ...business, access: { status: 'active', enforced: true }, paidCapacity: 3,
    capacity: { allowed: false, reason: 'BILLING_CAPACITY_REQUIRED', additionalFils: 5000 } };
  rpc.mockImplementation(() => Promise.resolve(actual));
  render(<MemoryRouter initialEntries={['/admin/subscriptions/one']}><Routes><Route path="/admin/subscriptions/:businessId" element={<SubscriptionBilling admin/>}/></Routes></MemoryRouter>);
  await screen.findByText('Paid barber places');
  expect(screen.getByText('Additional amount this period')).toBeVisible();
  expect(screen.queryByText('Add one active barber today')).toBeNull();
});
