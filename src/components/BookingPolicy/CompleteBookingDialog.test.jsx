import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompleteBookingDialog from './CompleteBookingDialog';
import en from '../../i18n/locales/en.json';

const rpc = vi.hoisted(() => ({ completionPayment: vi.fn() }));
const translate = (key) => key.split('.').reduce((value, part) => value?.[part], en) || key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate, i18n: { language: 'en' } }) }));
vi.mock('../../services/bookings.service', () => ({ bookingsService: rpc }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); rpc.completionPayment.mockResolvedValue({ dueFils: '5000', onlinePaid: false }); });

it('requires a method and submits the reviewed balance only once while saving', async () => {
  const save = vi.fn(() => new Promise(() => {}));
  render(<CompleteBookingDialog bookingId="test-booking" onClose={vi.fn()} onConfirm={save} />);
  const selector = await screen.findByLabelText('Payment method');
  const button = screen.getByRole('button', { name: 'Complete appointment' });
  expect(button.disabled).toBe(true);
  fireEvent.change(selector, { target: { value: 'cash' } });
  fireEvent.click(button); fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('cash', '5000');
});

it('allows completion as unpaid without implying receipt of money', async () => {
  const save = vi.fn().mockResolvedValue({});
  render(<CompleteBookingDialog bookingId="test-booking" onClose={vi.fn()} onConfirm={save} />);
  fireEvent.change(await screen.findByLabelText('Payment method'), { target: { value: 'unpaid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete appointment' }));
  expect(save).toHaveBeenCalledWith('unpaid', '5000');
});

it('keeps verified online payment without a method override', async () => {
  rpc.completionPayment.mockResolvedValue({ dueFils: '0', onlinePaid: true });
  const save = vi.fn().mockResolvedValue({});
  render(<CompleteBookingDialog bookingId="test-booking" onClose={vi.fn()} onConfirm={save} />);
  await screen.findByText('Already paid online');
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Complete appointment' }));
  expect(save).toHaveBeenCalledWith(null, '0');
});

it('refreshes a stale balance and requires another explicit selection', async () => {
  rpc.completionPayment.mockResolvedValueOnce({ dueFils: '5000' }).mockResolvedValueOnce({ dueFils: '3000' });
  const save = vi.fn().mockRejectedValue(new Error('COMPLETION_PAYMENT_CHANGED'));
  render(<CompleteBookingDialog bookingId="test-booking" onClose={vi.fn()} onConfirm={save} />);
  fireEvent.change(await screen.findByLabelText('Payment method'), { target: { value: 'card' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete appointment' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByLabelText('Payment method').value).toBe(''));
  expect(screen.getByRole('button', { name: 'Complete appointment' }).disabled).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
});

it('does not complete when the appointment is too early or cannot be loaded', async () => {
  rpc.completionPayment.mockRejectedValue(new Error('BOOKING_NOT_FINISHED'));
  const save = vi.fn();
  render(<CompleteBookingDialog bookingId="test-booking" onClose={vi.fn()} onConfirm={save} />);
  expect((await screen.findByRole('alert')).textContent).toContain('has not finished');
  expect(screen.getByRole('button', { name: 'Complete appointment' }).disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});
