import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import CustomerBooking from './CustomerBooking';
import { customerBookingService } from '../services/customerBooking.service';

vi.mock('../context/AppContext', () => ({ useApp: () => ({ setLanguage: vi.fn() }) }));
vi.mock('../services/customerBooking.service', () => ({ customerBookingService: { getCatalog: vi.fn(), getSlots: vi.fn(), requestCode: vi.fn(), verifyCode: vi.fn(), book: vi.fn() } }));
const catalog = {
  branches: [{ id: 'branch', name: 'Seafront shop', city: 'Kuwait City', address: 'Waterfront' }, { id: 'other', name: 'Salmiya shop', city: 'Salmiya' }],
  barbers: [{ id: 'omar', branchId: 'branch', name: 'Omar', serviceIds: ['hair'], maxBookingDays: 30 }, { id: 'ali', branchId: 'branch', name: 'Ali', serviceIds: ['beard'], maxBookingDays: 30 }],
  services: [{ id: 'hair', branchId: 'branch', name: 'Haircut', duration: 30, price: 5 }, { id: 'beard', branchId: 'branch', name: 'Beard trim', duration: 15, price: 3 }],
};
const receipt = { id: 'saved', reference: 'TESTREF', branchName: 'Seafront shop', barberName: 'Omar', date: '2026-10-31', time: '10:00', duration: 30, price: 5, services: [{ name: 'Haircut' }] };
let i18n;
beforeEach(async () => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  customerBookingService.getCatalog.mockResolvedValue(catalog);
  customerBookingService.getSlots.mockResolvedValue({ slots: ['10:00', '10:30'] });
  customerBookingService.requestCode.mockResolvedValue({ challenge: 'challenge', testCode: '123456' });
  customerBookingService.verifyCode.mockResolvedValue({ verification: 'verified' });
  customerBookingService.book.mockResolvedValue(receipt);
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
  render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerBooking /></MemoryRouter></I18nextProvider>);
  await screen.findByLabelText('City');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const click = name => fireEvent.click(screen.getAllByRole('button', { name, exact: true }).find(button => !button.disabled));
const heading = () => screen.getByRole('heading', { level: 1 });
const changeCity = city => fireEvent.change(screen.getByLabelText('City'), { target: { value: city } });
async function chooseAppointment() {
  changeCity('Kuwait City');
  expect(screen.queryByText('Salmiya shop')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Seafront/ }));
  click('Choose your appointment');
  expect(heading()).toHaveTextContent('Your appointment');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Omar/ }));
  expect(screen.queryByText('Beard trim')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Haircut/ }));
  fireEvent.click(await screen.findByRole('radio', { name: /10:00/ }));
  expect(heading()).toHaveTextContent('Your appointment');
  click('Continue to confirmation');
  expect(heading()).toHaveTextContent('Confirm your booking');
}
async function requestVerification() {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test Customer' } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '5000-0099' } });
  click('Get verification code');
  await screen.findByLabelText('Verification code');
}
const enterCode = () => fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });

describe('three-screen guest booking', () => {
  it('keeps city and branch on one screen, then barber/services/time on one screen, and verifies and confirms inline', async () => {
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search shops')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose your appointment' })).toBeDisabled();
    await chooseAppointment();
    expect(screen.getByRole('region', { name: 'Booking summary' })).toHaveTextContent('Haircut');
    await requestVerification();
    expect(heading()).toHaveTextContent('Confirm your booking');
    expect(customerBookingService.book).not.toHaveBeenCalled();
    enterCode(); click('Verify & confirm booking');
    await screen.findByText('TESTREF');
    expect(customerBookingService.verifyCode).toHaveBeenCalledTimes(1);
    expect(customerBookingService.book).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch', barberId: 'omar', serviceIds: ['hair'], verification: 'verified', time: '10:00' }));
  });
  it('resets the branch and appointment when changing city, and supports search and empty results', async () => {
    await chooseAppointment(); click('Edit: Shop');
    fireEvent.change(screen.getByLabelText('Search shops'), { target: { value: 'missing' } });
    expect(screen.getByText('No shops found')).toBeInTheDocument();
    click('Clear search');
    changeCity('Salmiya');
    expect(screen.queryByText('Seafront shop')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose your appointment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Salmiya/ })); click('Choose your appointment');
    expect(screen.getByText('No barbers available')).toBeInTheDocument();
    expect(screen.queryByText('Haircut')).not.toBeInTheDocument();
  });
  it('clears incompatible services and time when choosing another barber', async () => {
    await chooseAppointment(); click('Edit: Barber');
    fireEvent.click(screen.getByRole('radio', { name: /Ali/ }));
    expect(screen.getByRole('checkbox', { name: /Beard trim/ })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Haircut/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select a date')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled();
  });
  it('validates details and refuses an invalid code before creating a booking', async () => {
    await chooseAppointment(); click('Get verification code');
    expect(screen.getByText(en.customerBooking.nameError)).toBeInTheDocument();
    expect(customerBookingService.requestCode).not.toHaveBeenCalled();
    await requestVerification();
    customerBookingService.verifyCode.mockRejectedValue(new Error('INVALID_CODE'));
    enterCode(); click('Verify & confirm booking');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.customerBooking.errors.INVALID_CODE);
    expect(customerBookingService.book).not.toHaveBeenCalled();
    expect(heading()).toHaveTextContent('Confirm your booking');
  });
  it('retains the verified identity for an idempotent retry after an uncertain network failure', async () => {
    await chooseAppointment(); await requestVerification(); enterCode();
    customerBookingService.book.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    click('Verify & confirm booking');
    await screen.findByRole('alert');
    click('Confirm booking'); await screen.findByText('TESTREF');
    expect(customerBookingService.verifyCode).toHaveBeenCalledTimes(1);
    expect(customerBookingService.book.mock.calls[0][0]).toEqual(customerBookingService.book.mock.calls[1][0]);
  });
  it('returns a slot conflict to the appointment screen with details and verification preserved', async () => {
    await chooseAppointment(); await requestVerification(); enterCode();
    customerBookingService.book.mockRejectedValueOnce(new Error('SLOT_UNAVAILABLE'));
    click('Verify & confirm booking');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.customerBooking.errors.SLOT_UNAVAILABLE);
    expect(heading()).toHaveTextContent('Your appointment');
    fireEvent.click(await screen.findByRole('radio', { name: /10:30/ }));
    click('Continue to confirmation');
    expect(screen.getByText('Test Customer')).toBeInTheDocument();
    click('Confirm booking'); await screen.findByText('TESTREF');
    expect(customerBookingService.verifyCode).toHaveBeenCalledTimes(1);
    expect(customerBookingService.book.mock.calls[1][0].time).toBe('10:30');
  });
  it('renders Arabic copy and RTL direction with the same three-screen order', async () => {
    await i18n.changeLanguage('ar');
    await waitFor(() => expect(heading()).toHaveTextContent(ar.customerBooking.three.titles.location));
    expect(heading().closest('.customer-booking')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: ar.customerBooking.three.nextAppointment })).toBeDisabled();
  });
});
