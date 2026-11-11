import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../../i18n/locales/en.json';
import BookingShareControls from './BookingShareControls';
import { bookingShareService } from '../../services/bookingShare.service';
vi.mock('../../services/bookingShare.service', () => ({ bookingShareService: { create: vi.fn(), revoke: vi.fn() } }));
const url = `https://test.example/booking/share#${'a'.repeat(64)}`;
let i18n;
beforeEach(async () => {
  vi.resetAllMocks();
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  bookingShareService.create.mockResolvedValue({ url, expiresAt: '2027-01-02T12:00:00Z' });
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockResolvedValue() });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue() } });
});
afterEach(cleanup);
const mount = props => render(<I18nextProvider i18n={i18n}><BookingShareControls bookingId="appointment" {...props} /></I18nextProvider>);
it('shares a private URL rather than appointment text, with a separate owner preview', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: en.bookingShare.share }));
  expect(await screen.findByRole('link', { name: 'Preview' })).toHaveAttribute('href', url);
  fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
  expect(navigator.share).toHaveBeenCalledWith({ title: 'Shared appointment', url });
  expect(navigator.share.mock.calls[0][0]).not.toHaveProperty('text');
});
it('copy fallback preserves the complete fragment and stop sharing removes the active link', async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  bookingShareService.revoke.mockResolvedValue({ sharing: false });
  mount(); fireEvent.click(screen.getByRole('button', { name: en.bookingShare.share }));
  fireEvent.click(await screen.findByRole('button', { name: 'Share link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
  fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
  expect(await screen.findByRole('button', { name: 'Create new link' })).toBeVisible();
  expect(bookingShareService.revoke).toHaveBeenCalledWith('appointment', undefined);
  expect(screen.queryByRole('link', { name: 'Preview' })).not.toBeInTheDocument();
});
it('guest receipt is supplied only to the private management request, never the shared URL', async () => {
  mount({ receipt: 'sealed-private-receipt' }); fireEvent.click(screen.getByRole('button', { name: en.bookingShare.share }));
  const preview = await screen.findByRole('link', { name: 'Preview' });
  expect(bookingShareService.create).toHaveBeenCalledWith('appointment', 'sealed-private-receipt');
  expect(preview.getAttribute('href')).not.toContain('receipt');
});
it('an ownership/session failure does not expose an old link or offer public management', async () => {
  bookingShareService.create.mockRejectedValue(new Error('AUTH_REQUIRED'));
  mount(); fireEvent.click(screen.getByRole('button', { name: en.bookingShare.share }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.bookingShare.signInRequired);
  expect(screen.queryByRole('link', { name: 'Preview' })).not.toBeInTheDocument();
});
