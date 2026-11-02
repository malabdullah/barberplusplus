import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const getById = vi.hoisted(() => vi.fn());
vi.mock('../services/bookings.service', () => ({ bookingsService: { getById } }));
import { useNotificationBooking } from './useNotificationBooking';
const wrapper = ({ children }) => <MemoryRouter initialEntries={['/dashboard/bookings?booking=saved-id']}>{children}</MemoryRouter>;
const services = [{ id: 'service-1', name: 'Haircut' }];
describe('authorized notification booking links', () => {
  it('opens current server details and moves the calendar to their date', async () => {
    getById.mockResolvedValue({ id: 'saved-id', date: '2026-11-12', time: '12:00', serviceIds: ['service-1'], barberName: 'Current barber' });
    const select = vi.fn(), week = vi.fn(), day = vi.fn();
    renderHook(() => useNotificationBooking(services, select, week, day), { wrapper });
    await waitFor(() => expect(select).toHaveBeenCalledWith(expect.objectContaining({ time: '12:00', serviceName: 'Haircut', barberName: 'Current barber' })));
    expect(week).toHaveBeenCalledWith(new Date('2026-11-12T12:00:00'));
    expect(day).toHaveBeenCalled();
  });
  it('does not open a stale booking after RLS denies its new assignment', async () => {
    getById.mockResolvedValue(null);
    const select = vi.fn(), week = vi.fn();
    const { result } = renderHook(() => useNotificationBooking(services, select, week), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
    expect(select).not.toHaveBeenCalled();
    expect(week).not.toHaveBeenCalled();
  });
});
