import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AutoConfirmBookings from './AutoConfirmBookings';
import { barberConfirmationService } from '../../services/barberConfirmation.service';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
vi.mock('../../services/barberConfirmation.service', () => ({ barberConfirmationService: { read: vi.fn(), save: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('loads persisted choice, saves a change and shows it only after success', async () => {
  barberConfirmationService.read.mockResolvedValue(false);
  let resolve; barberConfirmationService.save.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<AutoConfirmBookings barberId="barber" />);
  const toggle = screen.getByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toHaveAttribute('aria-checked','false');
  fireEvent.click(toggle); expect(toggle).toBeDisabled(); expect(toggle).toHaveAttribute('aria-checked','false');
  resolve(true); await waitFor(() => expect(toggle).toHaveAttribute('aria-checked','true'));
  expect(barberConfirmationService.save).toHaveBeenCalledWith('barber',true);
});
it('keeps the previous choice visible and reports a save error', async () => {
  barberConfirmationService.read.mockResolvedValue(true);barberConfirmationService.save.mockRejectedValue(Error('offline'));
  render(<AutoConfirmBookings barberId="barber" />); const toggle=screen.getByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());fireEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('autoConfirmation.failed');expect(toggle).toHaveAttribute('aria-checked','true');
});
it('does not allow a toggle before the server value is known and offers retry', async () => {
  barberConfirmationService.read.mockRejectedValueOnce(Error('offline')).mockResolvedValue(false);
  render(<AutoConfirmBookings barberId="barber" />);expect(await screen.findByRole('alert')).toBeVisible();expect(screen.getByRole('switch')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'common.retry'}));await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','false');
});
