import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../services/subscriptionBilling.service', async importOriginal => ({ ...(await importOriginal()), subscriptionRpc: rpc }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../context/AppContext', () => ({ useApp: () => ({ user: { id: 'manager' }, theme: 'light', language: 'en' }) }));
import '../i18n';
import SubscriptionBilling from './SubscriptionBilling';

const business = { id: 'one', name: 'A real Test business', managerId: 'manager', managerName: 'Manager', count: 3, frequency: 'monthly', nextFrequency: null, renewalRequested: true, revision: 4, priceFils: 30000, canManage: true, access: { status: 'not_started', until: null }, shops: [], managers: [], invoices: [], history: [], grants: [] };
beforeEach(() => {
  rpc.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  rpc.mockImplementation(action => Promise.resolve(action === 'businesses' ? { rows: [business], hasMore: false } : action === 'detail' ? business : action === 'quote' ? { count: 3, subtotalFils: 30000, totalFils: 24000, discountFils: 6000, normalRenewalFils: 30000, discountPayments: 1 } : { saved: true }));
});
afterEach(cleanup);
const open = () => render(<MemoryRouter><SubscriptionBilling /></MemoryRouter>);
it('uses backend totals and re-reads after a saved preference', async () => {
  open();
  await screen.findByRole('heading', { name: business.name });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate estimate' }));
  await screen.findByText('KD 24.000');
  fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
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
