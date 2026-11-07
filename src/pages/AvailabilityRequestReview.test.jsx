import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ call: vi.fn(), item: null, blocked: false, previewError: false }));
vi.mock('../services/availability.service', () => ({ availabilityService: { call: (...args) => state.call(...args) } }));
vi.mock('../context/AppContext', () => ({ useApp: () => ({ barbers: [{ id: 'staff', name: 'Omar' }], branches: [{ id: 'shop', name: 'Shop' }], reloadData: async () => {} }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) }));
import AvailabilityRequestReview from './AvailabilityRequestReview';
const setup = () => render(<MemoryRouter initialEntries={['/dashboard/availability-requests/request']}><Routes><Route path="/dashboard/availability-requests/:requestId" element={<AvailabilityRequestReview />} /></Routes></MemoryRouter>);
beforeEach(() => {
  state.call.mockReset(); state.blocked = false; state.previewError = false;
  state.item = { id: 'request', category: 'break', target_key: 'break-a', barber_id: 'staff', status: 'pending', base_value: null,
    requested_value: { id: 'break-a', type: 'recurring', day: 'monday', start: '12:00', end: '13:00' }, created_at: '2026-11-07T09:00:00Z' };
  state.call.mockImplementation(async (action, data) => {
    if (action === 'get') return { barber: { id: 'staff', name: 'Omar', branch_id: 'shop' }, selected_request: { ...state.item }, related_items: [] };
    if (action === 'preview') { if (state.previewError) throw new Error('NOT_AUTHORIZED'); return { conflicts: state.blocked ? [{ id: 'booking', customer_name: 'Customer', date: '2026-11-09', time: '10:00', duration: 30 }] : [] }; }
    if (action === 'approve' && state.blocked) return { blocked: true, conflicts: [{ id: 'booking', customer_name: 'Customer', date: '2026-11-09', time: '10:00', duration: 30 }] };
    state.item = { ...state.item, status: action === 'approve' ? 'approved' : 'declined', approved_value: data.value, review_note: data.note };
    return { blocked: false, request: state.item };
  });
});
afterEach(cleanup);
it('blocks only this conflicting item and links to its appointment resolution', async () => {
  state.blocked = true; setup();
  fireEvent.click(await screen.findByRole('button', { name: 'availabilityItems.approve' }));
  const resolve = await screen.findByRole('link', { name: 'availabilityApproval.resolveBooking' });
  expect(resolve).toHaveAttribute('href', '/dashboard/bookings?booking=booking&reviewBarber=staff&reviewRequest=request');
  expect(screen.getByRole('button', { name: 'availabilityItems.approve' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.decline', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'availabilityItems.declineReason' }), { target: { value: 'Choose another time' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'availabilityItems.decline', exact: true }).at(-1));
  await screen.findByText('availabilityItems.declinedNotice');
  expect(state.call).toHaveBeenCalledWith('decline', expect.objectContaining({ request_id: 'request', note: 'Choose another time' }));
});
it('submits a modified break as a single item decision without a bundled proposal', async () => {
  setup(); await screen.findByRole('button', { name: 'availabilityItems.modify' });
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.modify' }));
  fireEvent.change(screen.getByLabelText('availability.from', { exact: true }), { target: { value: '12:30' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'availabilityItems.approveModified' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.approveModified' }));
  await screen.findByText('availabilityItems.approvedNotice');
  const decision = state.call.mock.calls.find(([action]) => action === 'approve')[1];
  expect(decision).toEqual({ request_id: 'request', value: expect.objectContaining({ id: 'break-a', start: '12:30' }), note: '' });
  expect(decision).not.toHaveProperty('proposal');
});
it('approves an explicit removal with a null value and offers no empty modification form', async () => {
  state.item = { ...state.item, base_value: state.item.requested_value, requested_value: null }; setup();
  await waitFor(() => expect(screen.getByRole('button', { name: 'availabilityItems.approve' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'availabilityItems.modify' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'availabilityItems.approve' }));
  await screen.findByText('availabilityItems.approvedNotice');
  expect(state.call).toHaveBeenCalledWith('approve', { request_id: 'request', value: null, note: '' });
});
it('keeps approval disabled if the current conflict preview fails', async () => {
  state.previewError = true; setup();
  fireEvent.click(await screen.findByRole('button', { name: 'availabilityItems.modify' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'availabilityItems.approveModified' })).toBeDisabled();
});
