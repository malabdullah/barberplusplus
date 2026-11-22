import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as renderWithLibrary, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const render = element => renderWithLibrary(element, { wrapper: MemoryRouter });
const { rpc, context } = vi.hoisted(() => ({ rpc: vi.fn(), context: { user: { id: 'manager' } } }));
vi.mock('../services/settlements.service', () => ({ settlementRpc: rpc }));
vi.mock('../services/settlementExport.service', () => ({ exportSettlement: vi.fn() }));
vi.mock('../context/AppContext', () => ({ useApp: () => context }));
import '../i18n';
import Settlements from './Settlements';
const shop = { id: 'shop', name: 'Settlement QA shop', balanceFils: '95000', availableFils: '95000', reservedFils: '0' };
const receipt = { id: 'receipt', sourceRef: 'verified-payment', amountFils: '100000', commissionFils: '5000', netFils: '95000', remainingFils: '95000', eligible: true, feeKnown: true, settledAt: '2026-11-20T12:00:00Z', collectedAt: '2026-11-20T12:00:00Z', bookingDate: '2026-11-01', bookingTime: '10:00' };
beforeEach(() => {
  rpc.mockReset(); context.user = { id: 'manager' };
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  rpc.mockImplementation(async (_, action) => action === 'shops' ? { rows: [shop] } : action === 'receipts' ? { rows: [receipt] } : { rows: [] });
});
afterEach(cleanup);
it('refreshes the list on demand without interrupting statement actions', async () => {
  const statement = { id: 'november', period: '2026-11-01', state: 'final', totalFils: '190000', currentFils: '190000' };
  let releaseRefresh;
  const pendingRefresh = new Promise(resolve => { releaseRefresh = resolve; });
  let statementLoads = 0;
  rpc.mockImplementation(async (_, action) => {
    if (action === 'shops') return { rows: [shop] };
    if (action === 'statements') return ++statementLoads === 1 ? { rows: [statement] } : pendingRefresh;
    if (action === 'statement') return statement;
    if (action === 'statement-rows') return { rows: ['booking-one', 'booking-two'].map(id => ({
      snapshot: { id, bookingId: id, bookingDate: '2026-11-20', netFils: '95000' },
      current: { netFils: '95000', paidFils: '0', remainingFils: '95000' },
    })) };
    return { rows: [] };
  });
  const view = render(<Settlements admin />);
  fireEvent.click(await screen.findByRole('button', { name: shop.name }));
  fireEvent.click(screen.getByRole('button', { name: 'Statements' }));
  const openStatement = await screen.findByRole('button', { name: 'View' });
  try {
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
    expect(statementLoads).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(statementLoads).toBe(2);
    expect(screen.getByRole('button', { name: 'View' })).toBe(openStatement);
    fireEvent.click(openStatement);
    const dialog = screen.getByRole('dialog', { name: 'Statement' });
    await within(dialog).findByText('booking-one');
    expect(within(dialog).getByText('booking-two')).toBeVisible();
  } finally {
    view.unmount();
    releaseRefresh({ rows: [statement] });
  }
});
it('gives managers read-only records without internal settings or write actions', async () => {
  render(<Settlements />);
  fireEvent.click(await screen.findByRole('button', { name: shop.name }));
  await screen.findByText(receipt.sourceRef);
  expect(screen.queryByRole('button', { name: 'Record receipt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Settlement settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record refund' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Transactions' })).toBeVisible();
  expect(rpc.mock.calls.every(([admin]) => !admin)).toBe(true);
});
it('loads booking options and transaction history without treating either as statement rows', async () => {
  rpc.mockImplementation(async (_, action) => {
    if (action === 'shops') return { rows: [shop] };
    if (action === 'receipts') return { rows: [receipt] };
    if (action === 'bookings') return { rows: [{ id: 'booking-to-receipt', date: '2026-11-19', time: '09:00', status: 'completed', priceFils: '100000' }] };
    return { rows: [{ id: 'journal-entry', kind: 'receipt', amountFils: '100000', externalRef: receipt.sourceRef, occurredAt: receipt.collectedAt }] };
  });
  render(<Settlements admin />);
  fireEvent.click(await screen.findByRole('button', { name: shop.name }));
  fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }));
  const recordDialog = screen.getByRole('dialog', { name: 'Record receipt' });
  expect(await within(recordDialog).findByRole('radio', { name: /booking-to-receipt/ })).toBeVisible();
  fireEvent.click(within(recordDialog).getAllByRole('button', { name: 'Close' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Transactions' }));
  const journalDialog = screen.getByRole('dialog', { name: 'Transactions' });
  expect(await within(journalDialog).findByText(/verified-payment/)).toBeVisible();
});
it('keeps a failed write retry idempotent and submits commission in basis points', async () => {
  rpc.mockImplementation(async (_, action) => {
    if (action === 'save-policy') throw new Error('SETTLEMENT_FAILED');
    return action === 'shops' ? { rows: [shop] } : { defaultRate: null };
  });
  render(<Settlements admin />);
  fireEvent.click(await screen.findByRole('button', { name: 'Default commission' }));
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByText('Not configured');
  fireEvent.change(within(dialog).getByLabelText('Commission (%)'), { target: { value: '5.25' } });
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Verified policy' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await within(dialog).findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(rpc.mock.calls.filter(([, a]) => a === 'save-policy')).toHaveLength(2));
  const writes = rpc.mock.calls.filter(([, a]) => a === 'save-policy');
  expect(writes[0][2]).toMatchObject({ rateBps: 525, reason: 'Verified policy', requestId: expect.any(String) });
  expect(writes[0][2]).not.toHaveProperty('feeBearer');
  expect(writes[0][2].requestId).toBe(writes[1][2].requestId);
});
it('clears financial records when live ownership access is revoked', async () => {
  render(<Settlements />);
  fireEvent.click(await screen.findByRole('button', { name: shop.name }));
  await screen.findByText(receipt.sourceRef);
  rpc.mockRejectedValue(new Error('SETTLEMENT_FORBIDDEN'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(receipt.sourceRef)).toBeNull();
});
it('keeps an unknown-outcome transfer reserved instead of offering cancellation', async () => {
  rpc.mockImplementation(async (_, action) => action === 'shops' ? { rows: [shop] } : action === 'payouts' ? { rows: [{ id: 'transfer', state: 'uncertain', amountFils: '50000', createdAt: '2026-11-20T12:00:00Z', payeeName: 'Verified payee', ibanLastFour: '1234' }] } : { rows: [] });
  render(<Settlements admin />);
  fireEvent.click(await screen.findByRole('button', { name: shop.name }));
  fireEvent.click(screen.getByRole('button', { name: 'Transfers' }));
  await screen.findByText('Bank outcome unknown');
  expect(screen.queryByRole('button', { name: 'Cancel preparation' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Record confirmed bank transfer' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm transfer failed' })).toBeVisible();
});
