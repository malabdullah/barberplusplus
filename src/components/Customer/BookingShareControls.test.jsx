import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../../i18n/locales/en.json';
import BookingShareControls from './BookingShareControls';
import { bookingShareService } from '../../services/bookingShare.service';
vi.mock('../../services/bookingShare.service', () => ({ bookingShareService: { create: vi.fn() } }));
const url = `https://test.example/booking/share#${'a'.repeat(64)}`;
let i18n;
beforeEach(async () => {
  vi.resetAllMocks();
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  bookingShareService.create.mockResolvedValue({ url, expiresAt: '2027-01-02T12:00:00Z' });
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockResolvedValue() });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue() } });
});
afterEach(cleanup);
const mount = props => render(<I18nextProvider i18n={i18n}><BookingShareControls bookingId="appointment" {...props} /></I18nextProvider>);
const ready = async () => { const button = screen.getByRole('button', { name: en.bookingShare.share }); await waitFor(() => expect(button).toBeEnabled()); return button; };
it('opens system sharing directly with the URL, without a management dialog', async () => {
  mount(); fireEvent.click(await ready());
  expect(navigator.share).toHaveBeenCalledWith({ title: 'Shared appointment', url });
  expect(bookingShareService.create).toHaveBeenCalledTimes(1);
  expect(navigator.share.mock.calls[0][0]).not.toHaveProperty('text');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText(/Stop sharing|Preview|Create new link|Available until/)).not.toBeInTheDocument();
});
it('copies the complete URL directly when system sharing is unavailable', async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  mount(); fireEvent.click(await ready());
  expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
it('cancelling the system sheet does not copy or revoke anything', async () => {
  navigator.share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  mount(); fireEvent.click(await ready());
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('a blocked system share falls back to copy; blocked clipboard exposes only a selectable URL', async () => {
  navigator.share.mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
  navigator.clipboard.writeText.mockRejectedValue(new Error('Clipboard blocked'));
  mount(); fireEvent.click(await ready());
  const input = await screen.findByRole('textbox', { name: en.bookingShare.link });
  expect(input).toHaveValue(url); expect(input).toHaveAttribute('readonly');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
it('guest receipt remains private and is never placed in the shared URL', async () => {
  mount({ receipt: 'sealed-private-receipt' }); fireEvent.click(await ready());
  expect(bookingShareService.create).toHaveBeenCalledWith('appointment', 'sealed-private-receipt');
  expect(navigator.share.mock.calls[0][0].url).not.toContain('receipt');
});
it('prepares lazily when More opens, and a new booking revision obtains a fresh snapshot', async () => {
  const view = render(<I18nextProvider i18n={i18n}><details><summary>More</summary><BookingShareControls bookingId="appointment" revision="original" menuItem /></details></I18nextProvider>);
  expect(bookingShareService.create).not.toHaveBeenCalled();
  const menu = view.container.querySelector('details'); menu.open = true; fireEvent(menu, new Event('toggle'));
  const button = await ready(); fireEvent.click(button); expect(navigator.share).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(button).toBeEnabled());
  view.rerender(<I18nextProvider i18n={i18n}><BookingShareControls bookingId="appointment" revision="rescheduled" /></I18nextProvider>);
  await ready(); expect(bookingShareService.create).toHaveBeenCalledTimes(2);
});
it('an ownership/session failure never offers a cached URL', async () => {
  bookingShareService.create.mockRejectedValue(new Error('AUTH_REQUIRED'));
  mount(); expect(await screen.findByRole('alert')).toHaveTextContent(en.bookingShare.signInRequired);
  expect(navigator.share).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('a late share failure after leaving the account cannot copy an old URL', async () => {
  let reject;
  navigator.share.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const view = mount(); fireEvent.click(await ready());
  view.unmount(); reject(new DOMException('Blocked', 'NotAllowedError'));
  await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});
