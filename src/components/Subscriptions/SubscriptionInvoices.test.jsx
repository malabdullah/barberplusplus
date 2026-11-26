import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../../lib/runtimeConfig', () => ({ isTest: false }));
vi.mock('../../utils/subscriptionInvoicePdf', () => ({ downloadSubscriptionInvoice: download }));
import SubscriptionInvoices from './SubscriptionInvoices';
afterEach(() => { cleanup(); download.mockReset(); });
const invoice = { id: 'receipt', state: 'paid', created_at: '2026-11-26T09:00:00Z', total_fils: 15000 };
const props = { business: { name: 'A shop', invoices: [invoice] }, date: () => '26 Nov 2026', money: () => 'KD 15.000' };
it('allows an existing production invoice download without a payment gateway', async () => {
  download.mockResolvedValue();
  render(<SubscriptionInvoices {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(download).toHaveBeenCalledWith(expect.objectContaining({ invoice, businessName: 'A shop', isTest: false })));
});
it('shows a download error and lets the manager retry', async () => {
  download.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce();
  render(<SubscriptionInvoices {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
});
