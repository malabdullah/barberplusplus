import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../i18n';
vi.mock('../../lib/runtimeConfig', () => ({ appConfig: { environment: 'cloud-test', cloudTestProjectRef: 'qvkucvcjmojjbphlzlks', appUrl: 'https://barber-test.alabdullah-cs.workers.dev' } }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } } }));
import MyFatoorahTestCheckout from './MyFatoorahTestCheckout';
const business = { id: 'demo', count: 0, frequency: 'monthly', paidCapacity: 0 };
const onEligible = vi.fn();
const onPaid = vi.fn();
function open() { render(<MemoryRouter><MyFatoorahTestCheckout business={business} money={f => `KD ${(f / 1000).toFixed(3)}`} date={String} onEligible={onEligible} onPaid={onPaid}/></MemoryRouter>); }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => Response.json(JSON.parse(options.body).action === 'read'
    ? { eligible: true } : { totalFils: 15000, subtotalFils: 30000, discountFils: 15000 })));
  onEligible.mockClear(); onPaid.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('quotes the selected sandbox method and editable discount using the manager session', async () => {
  open(); await screen.findByRole('region', { name: 'MyFatoorah checkout' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Payment method' }), { target: { value: 'CARD' } });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Discount code' }), { target: { value: 'MYFTEST50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review total' }));
  await screen.findByRole('button', { name: 'Pay with MyFatoorah (Test)' });
  expect(fetch).toHaveBeenLastCalledWith('/test-api/myfatoorah-subscription', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer test-session' }),
    body: JSON.stringify({ count: 3, frequency: 'monthly', code: 'MYFTEST50', paymentMethod: 'CARD', action: 'quote', businessId: 'demo' }),
  }));
  expect(screen.getAllByText('KD 15.000').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('combobox', { name: 'Payment method' }), { target: { value: 'KNET' } });
  expect(screen.queryByRole('button', { name: 'Pay with MyFatoorah (Test)' })).toBeNull();
});
it('does not show the pilot for an unallowlisted business', async () => {
  fetch.mockResolvedValue(Response.json({ eligible: false })); open();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('region')).toBeNull();
});
