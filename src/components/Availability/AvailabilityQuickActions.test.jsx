import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
vi.mock('../../services/availability.service', () => ({ availabilityService: { call } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
import AvailabilityQuickActions from './AvailabilityQuickActions';
const item = { id: 'request-a', barber_id: 'barber-a', category: 'break', requested_value: { id: 'break-a', type: 'recurring', day: 'monday', start: '12:00', end: '13:00' } };
const setup = (request = item) => {
  const decided = vi.fn();
  render(<MemoryRouter><AvailabilityQuickActions item={request} onDecided={decided} /></MemoryRouter>);
  return decided;
};
beforeEach(() => { call.mockReset(); });
afterEach(cleanup);
it('approves directly from a row, prevents a duplicate submission and reports only its own decision', async () => {
  let finish;
  call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const decided = setup();
  const approve = screen.getByRole('button', { name: 'availabilityItems.approve', exact: true });
  fireEvent.click(approve); fireEvent.click(approve);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('approve', { request_id: item.id, value: item.requested_value, note: '' });
  finish({ blocked: false });
  await waitFor(() => expect(decided).toHaveBeenCalledWith(item.id, 'approved'));
});
it('keeps a blocked row pending and exposes its affected appointment', async () => {
  call.mockResolvedValue({ blocked: true, conflicts: [{ id: 'booking-a', customer_name: 'Ali', date: '2026-11-09', time: '10:00', duration: 30 }] });
  const decided = setup();
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.approve', exact: true }));
  expect(await screen.findByRole('link', { name: 'availabilityApproval.resolveBooking' })).toHaveAttribute('href', '/dashboard/bookings?booking=booking-a&reviewBarber=barber-a&reviewRequest=request-a');
  expect(decided).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'availabilityItems.approve', exact: true })).toBeDisabled();
});
it('requires a decline reason without showing an optional note for approval', async () => {
  call.mockResolvedValue({ blocked: false }); const decided = setup();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.decline', exact: true }));
  const field = screen.getByRole('textbox', { name: 'availabilityItems.declineReason' });
  const submit = screen.getAllByRole('button', { name: 'availabilityItems.decline', exact: true }).at(-1);
  expect(submit).toBeDisabled();
  fireEvent.change(field, { target: { value: '  Choose a later break  ' } }); fireEvent.click(submit);
  await waitFor(() => expect(decided).toHaveBeenCalledWith(item.id, 'declined'));
  expect(call).toHaveBeenCalledWith('decline', expect.objectContaining({ request_id: item.id, note: 'Choose a later break' }));
});
it('keeps a failed server decision actionable and does not claim success', async () => {
  call.mockRejectedValue(new Error('NOT_AUTHORIZED')); const decided = setup();
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.approve', exact: true }));
  await screen.findByRole('alert'); expect(decided).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'availabilityItems.approve', exact: true })).toBeEnabled();
});
it('checks every modified value and cannot submit a newer edit using an older preview', async () => {
  call.mockResolvedValue({ conflicts: [] }); setup();
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.modify' }));
  const save = screen.getByRole('button', { name: 'availabilityItems.approveModified' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.change(screen.getByLabelText('availability.from', { exact: true }), { target: { value: '12:45' } });
  expect(save).toBeDisabled();
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(call).toHaveBeenCalledWith('approve', { request_id: item.id, value: { ...item.requested_value, start: '12:45' }, note: '' }));
});
