import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import CustomerAccount from './CustomerAccount';
import { customerAuthService } from '../services/customerAuth.service';
const auth = vi.hoisted(() => ({ updateProfile: vi.fn(), logout: vi.fn(), customer: { id: 'customer', name: 'Test Customer', email: 'customer@example.test', phone: '', countryCode: '+965' } }));
vi.mock('../context/CustomerAuthContext', () => ({ useCustomerAuth: () => ({ loading: false, ...auth }) }));
vi.mock('../services/customerAuth.service', () => ({ customerAuthService: { bookings: vi.fn() } }));
let i18n;
beforeEach(async () => {
  vi.resetAllMocks(); customerAuthService.bookings.mockResolvedValue([]);
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);
function mount() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerAccount /></MemoryRouter></I18nextProvider>); }
it('keeps profile edits local until save, discards cancelled edits and validates invalid contact data', async () => {
  mount(); await screen.findByText(en.customerAuth.account.noAppointmentsTitle);
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Unsaved name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByDisplayValue('Unsaved name')).not.toBeInTheDocument(); expect(auth.updateProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  expect(screen.getByLabelText('Your name')).toHaveValue('Test Customer');
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'invalid-email' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.INVALID_DETAILS);
  expect(auth.updateProfile).not.toHaveBeenCalled();
});
it('preserves the edit form on failure and explains pending email confirmation after a successful save', async () => {
  auth.updateProfile.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({});
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'updated@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.customerAuth.errors.UNAVAILABLE);
  expect(screen.getByLabelText('Email address')).toHaveValue('updated@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText(en.customerAuth.email.changeSent)).toBeInTheDocument();
});
it('renders time values with seconds as Kuwait time and preserves status, services and currency in Arabic', async () => {
  customerAuthService.bookings.mockResolvedValue([{ id: 'booking', date: '2026-11-02', time: '09:30:00', price: 5, status: 'no_show', shop_name: 'Test Shop', shop_name_ar: 'صالون الاختبار', barber_name: 'Test Barber', barber_name_ar: 'حلاق الاختبار', services: [{ name: 'Haircut', name_ar: 'قص شعر' }] }]);
  await i18n.changeLanguage('ar'); mount();
  await screen.findByRole('heading', { name: 'صالون الاختبار' });
  expect(screen.getByText('قص شعر')).toBeInTheDocument(); expect(screen.getByText(ar.bookings.status.noShow)).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-11-02T06:30:00.000Z');
});
it('offers retry after appointment loading fails', async () => {
  customerAuthService.bookings.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  mount(); await screen.findByText(en.customerAuth.bookingsError);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(en.customerAuth.account.noAppointmentsTitle);
  expect(customerAuthService.bookings).toHaveBeenCalledTimes(2);
});
