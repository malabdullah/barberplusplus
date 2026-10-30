import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import CustomerBooking from './CustomerBooking';
import { addBookingDays, getKuwaitDate } from '../utils/customerBooking';
import { customerBookingService } from '../services/customerBooking.service';

vi.mock('../context/AppContext', () => ({ useApp: () => ({ setLanguage: vi.fn() }) }));
vi.mock('../services/customerBooking.service', () => ({ customerBookingService: { getCatalog: vi.fn(), getSlots: vi.fn(), requestCode: vi.fn(), verifyCode: vi.fn(), book: vi.fn() } }));
const catalog = {
  branches: [{ id: 'branch', name: 'Seafront shop', city: 'Kuwait City', address: 'Waterfront' }, { id: 'other', name: 'Salmiya shop', city: 'Salmiya' }],
  barbers: [{ id: 'omar', branchId: 'branch', name: 'Omar', serviceIds: ['hair', 'wash'], maxBookingDays: 30 }, { id: 'ali', branchId: 'branch', name: 'Ali', serviceIds: ['beard'], maxBookingDays: 30 }],
  services: [{ id: 'wash', branchId: 'branch', name: 'Hair wash', duration: 15, price: 2 }, { id: 'hair', branchId: 'branch', name: 'Haircut', duration: 30, price: 5 }, { id: 'beard', branchId: 'branch', name: 'Beard trim', duration: 15, price: 3 }],
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
  expect(heading()).toHaveTextContent('Book your appointment');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Omar/ }));
  expect(screen.queryByText('Beard trim')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Haircut/ }));
  expect(screen.getByLabelText('Select a date')).not.toBeVisible();
  click('Continue to date & time');
  expect(heading()).toHaveTextContent('Book your appointment');
  expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('radio', { name: /10:00/ }));
  expect(heading()).toHaveTextContent('Book your appointment');
  expect(screen.getByLabelText('Your name')).toBeVisible();
}
async function requestVerification() {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test Customer' } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '5000-0099' } });
  click('Get verification code');
  await screen.findByLabelText('Verification code');
}
const enterCode = () => fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });

describe('one-page guest booking', () => {
  it('guides city through confirmation on one page and verifies and confirms inline', async () => {
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search shops')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Find shops' })).toBeDisabled();
    await chooseAppointment();
    expect(screen.getByRole('region', { name: 'Booking summary' })).toHaveTextContent('Haircut');
    await requestVerification();
    expect(heading()).toHaveTextContent('Book your appointment');
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
    click('Edit: Choose your city');
    changeCity('Salmiya');
    expect(screen.queryByText('Seafront shop')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to barber' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Salmiya/ }));
    expect(screen.getByText('No barbers available')).toBeInTheDocument();
    expect(screen.queryByText('Haircut')).not.toBeInTheDocument();
  });
  it('clears incompatible services and time when choosing another barber', async () => {
    await chooseAppointment(); click('Edit: Barber');
    fireEvent.click(screen.getByRole('radio', { name: /Ali/ }));
    expect(screen.getByRole('checkbox', { name: /Beard trim/ })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Haircut/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select a date')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue to date & time' })).toBeDisabled();
  });
  it('validates details and refuses an invalid code before creating a booking', async () => {
    await chooseAppointment(); click('Get verification code');
    expect(screen.getByText(en.customerBooking.nameError)).toBeInTheDocument();
    expect(customerBookingService.requestCode).not.toHaveBeenCalled();
    await requestVerification();
    customerBookingService.verifyCode.mockRejectedValue(new Error('INVALID_CODE'));
    enterCode(); click('Verify & confirm booking');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.customerBooking.errors.INVALID_CODE);
    expect(section('Your details & confirmation')).toContainElement(screen.getByRole('alert'));
    expect(customerBookingService.book).not.toHaveBeenCalled();
    expect(heading()).toHaveTextContent('Book your appointment');
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
  it('returns a slot conflict to the time section with details and verification preserved', async () => {
    await chooseAppointment(); await requestVerification(); enterCode();
    customerBookingService.book.mockRejectedValueOnce(new Error('SLOT_UNAVAILABLE'));
    click('Verify & confirm booking');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.customerBooking.errors.SLOT_UNAVAILABLE);
    expect(section('Date & time')).toContainElement(screen.getByRole('alert'));
    expect(heading()).toHaveTextContent('Book your appointment');
    expect(screen.getByRole('button', { name: 'Continue to your details' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('radio', { name: /10:30/ }));
    expect(screen.getByText('Test Customer')).toBeInTheDocument();
    click('Confirm booking'); await screen.findByText('TESTREF');
    expect(customerBookingService.verifyCode).toHaveBeenCalledTimes(1);
    expect(customerBookingService.book.mock.calls[1][0].time).toBe('10:30');
  });
  it('renders Arabic copy and RTL direction with the same six-section order', async () => {
    await i18n.changeLanguage('ar');
    await waitFor(() => expect(heading()).toHaveTextContent(ar.customerBooking.onePage.title));
    expect(heading().closest('.customer-booking')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: ar.customerBooking.continue.branch })).toBeDisabled();
  });
});

const section = name => screen.getByRole('region', { name, exact: true });
const expandedSections = () => document.querySelectorAll('[data-booking-section].is-open');

it('opens only the next section and keeps completed city/shop summaries editable', async () => {
  expect(expandedSections()).toHaveLength(1);
  expect(section('Choose your city')).toHaveClass('is-open');
  expect(section('Choose your shop')).not.toHaveClass('is-open');
  changeCity('Kuwait City');
  expect(screen.getByLabelText('City')).not.toBeVisible();
  expect(screen.getByLabelText('Search shops')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Edit: Choose your city' })).toHaveAttribute('aria-expanded', 'false');
  expect(expandedSections()).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio', { name: /Seafront/ }));
  expect(screen.getByLabelText('Search shops')).not.toBeVisible();
  expect(expandedSections()).toHaveLength(1);
  expect(section('Choose your barber')).toHaveClass('is-open');
  expect(screen.getByRole('heading', { name: 'Choose your barber' })).toHaveFocus();
  click('Edit: Choose your city'); click('Done');
  expect(screen.getByLabelText('Search shops')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: /Seafront/ }));
  expect(expandedSections()).toHaveLength(1);
  expect(section('Choose your barber')).toHaveClass('is-open');
});

it('allows multiple services before continuing and collapses services and opens time on the same page', async () => {
  changeCity('Kuwait City'); fireEvent.click(screen.getByRole('radio', { name: /Seafront/ }));
  expect(expandedSections()).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio', { name: /Omar/ }));
  expect(section('Choose your barber')).not.toHaveClass('is-open');
  expect(section('Services')).toHaveClass('is-open');
  expect(screen.getByRole('heading', { name: 'Services', exact: true })).toHaveFocus();
  fireEvent.click(screen.getByRole('checkbox', { name: /Haircut/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Hair wash/ }));
  expect(section('Services')).toHaveClass('is-open');
  expect(customerBookingService.getSlots).not.toHaveBeenCalled();
  click('Continue to date & time');
  expect(section('Date & time')).toHaveClass('is-open');
  expect(section('Your details & confirmation')).not.toHaveClass('is-open');
  fireEvent.click(await screen.findByRole('radio', { name: /10:00/ }));
  expect(section('Date & time')).not.toHaveClass('is-open');
  expect(section('Your details & confirmation')).toHaveClass('is-open');
  expect(expandedSections()).toHaveLength(1);
  expect(customerBookingService.getSlots).toHaveBeenCalledWith(expect.objectContaining({ serviceIds: ['hair', 'wash'] }));
});

it('rechecks availability after editing date and retains the entered customer details', async () => {
  await chooseAppointment();
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Retained Name' } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '50000099' } });
  click('Edit: Date & time');
  expect(screen.getByLabelText('Your name')).not.toBeVisible();
  customerBookingService.getSlots.mockResolvedValue({ slots: ['11:00'] });
  const tomorrow = addBookingDays(getKuwaitDate(), 1);
  fireEvent.change(screen.getByLabelText('Select a date'), { target: { value: tomorrow } });
  expect(screen.getByRole('button', { name: 'Continue to your details' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('radio', { name: /11:00/ }));
  expect(screen.getByLabelText('Your name')).toHaveValue('Retained Name');
  expect(screen.getByLabelText('Mobile number')).toHaveValue('50000099');
  expect(expandedSections()).toHaveLength(1);
  expect(customerBookingService.getSlots).toHaveBeenLastCalledWith(expect.objectContaining({ date: tomorrow }));
});


it('opens the time section when restored availability fails and supports retrying', async () => {
  await chooseAppointment();
  cleanup();
  customerBookingService.getSlots.mockRejectedValueOnce(new Error('UNAVAILABLE'));
  render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerBooking /></MemoryRouter></I18nextProvider>);
  await screen.findByRole('alert');
  expect(section('Date & time')).toHaveClass('is-open');
  expect(section('Your details & confirmation')).not.toHaveClass('is-open');
  expect(screen.getByRole('button', { name: 'Continue to your details' })).toBeDisabled();
  click('Try again');
  fireEvent.click(await screen.findByRole('radio', { name: /10:30/ }));
  expect(section('Your details & confirmation')).toHaveClass('is-open');
  expect(screen.getByLabelText('Your name')).toBeVisible();
});


it('keeps all six section headings on one page and preserves unchanged selections while editing', async () => {
  const sections = () => [...document.querySelectorAll('[data-booking-section]')].map(item => item.getAttribute('data-booking-section'));
  const expectedSections = ['choose-city', 'choose-shop', 'choose-barber', 'choose-services', 'choose-time', 'choose-details'];
  expect(sections()).toEqual(expectedSections);
  await chooseAppointment();
  expect(sections()).toEqual(expectedSections);
  expect(screen.getByText('Section 6 of 6')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Back', exact: true })).not.toBeInTheDocument();
  click('Edit: Choose your shop'); click('Done');
  click('Done');
  expect(screen.getByRole('checkbox', { name: /Haircut/ })).toBeChecked();
  click('Continue to date & time');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to your details' })).toBeEnabled());
  click('Done');
  expect(screen.getByLabelText('Your name')).toBeVisible();
  expect(expandedSections()).toHaveLength(1);
});

it('restores the active service selection without advancing before Continue', async () => {
  changeCity('Kuwait City');
  fireEvent.click(screen.getByRole('radio', { name: /Seafront/ }));
  fireEvent.click(screen.getByRole('radio', { name: /Omar/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Haircut/ }));
  cleanup();
  render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerBooking /></MemoryRouter></I18nextProvider>);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Haircut/ })).toBeChecked());
  expect(section('Services')).toHaveClass('is-open');
  expect(customerBookingService.getSlots).not.toHaveBeenCalled();
});

it('reopens time when a restored selected slot is no longer available', async () => {
  await chooseAppointment();
  cleanup();
  customerBookingService.getSlots.mockResolvedValue({ slots: ['11:00'] });
  render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerBooking /></MemoryRouter></I18nextProvider>);
  await screen.findByRole('alert');
  expect(section('Date & time')).toHaveClass('is-open');
  expect(screen.queryByRole('button', { name: 'Get verification code' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /11:00/ }));
  expect(section('Your details & confirmation')).toHaveClass('is-open');
});


it('resumes shop selection when returning with only a city chosen', async () => {
  changeCity('Kuwait City');
  cleanup();
  render(<I18nextProvider i18n={i18n}><MemoryRouter><CustomerBooking /></MemoryRouter></I18nextProvider>);
  await waitFor(() => expect(screen.getByLabelText('Search shops')).toBeVisible());
  expect(screen.getByLabelText('City')).not.toBeVisible();
  expect(expandedSections()).toHaveLength(1);
});
