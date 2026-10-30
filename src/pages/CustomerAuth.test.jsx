import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import CustomerAuth from './CustomerAuth';
import { customerAuthService } from '../services/customerAuth.service';
const auth = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn(), resetPassword: vi.fn() }));
vi.mock('../context/CustomerAuthContext', () => ({ useCustomerAuth: () => ({ customer: null, loading: false, ...auth }) }));
vi.mock('../context/AppContext', () => ({ useApp: () => ({ setLanguage: vi.fn() }) }));
vi.mock('../services/customerAuth.service', () => ({ customerAuthService: { requestSignup: vi.fn(), requestRecovery: vi.fn() } }));
let i18n;
beforeEach(async () => {
  vi.resetAllMocks();
  customerAuthService.requestSignup.mockResolvedValue({ challenge: 'signup', testCode: '123456' });
  customerAuthService.requestRecovery.mockResolvedValue({ challenge: 'recovery', testCode: '654321' });
  auth.login.mockResolvedValue({}); auth.signup.mockResolvedValue({}); auth.resetPassword.mockResolvedValue({});
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = label => fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
const mount = (mode, state) => render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[{ pathname: `/customer/${mode}`, state }]}><Routes>{['sign-in', 'sign-up', 'forgot-password', 'reset-password'].map(view => <Route key={view} path={`/customer/${view}`} element={<CustomerAuth key={view} mode={view} />} />)}<Route path="/customer/account" element={<h1>Account destination</h1>} /><Route path="/book" element={<h1>Booking destination</h1>} /></Routes></MemoryRouter></I18nextProvider>);
describe('customer authentication screens', () => {
  it('creates an account without email only after verification and returns to booking', async () => {
    mount('sign-up', { returnTo: '/book' });
    fill('Your name', 'Test Customer'); fill('Mobile number', '50000099'); fill('Password', 'CustomerPassword123!'); fill('Confirm password', 'CustomerPassword123!');
    click('Create account'); await screen.findByLabelText('Verification code');
    expect(auth.signup).not.toHaveBeenCalled();
    fill('Verification code', '123456'); click('Verify & create account');
    await screen.findByText('Booking destination'); expect(auth.signup).toHaveBeenCalledWith({ challenge: 'signup', code: '123456', password: 'CustomerPassword123!' });
  });
  it('signs in by phone and renders a friendly credential error', async () => {
    mount('sign-in'); fill('Mobile number', '50000099'); fill('Password', 'incorrect');
    auth.login.mockRejectedValue(new Error('INVALID_LOGIN')); click('Sign in');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.customerAuth.errors.INVALID_LOGIN);
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ phone: '50000099', countryCode: '+965', password: 'incorrect' }));
  });
  it('requests phone recovery, resets with a code and returns to sign in', async () => {
    mount('forgot-password'); fill('Mobile number', '50000099'); click('Get recovery code');
    await screen.findByRole('heading', { name: 'Reset your password' });
    fill('New password', 'NewPassword123!'); fill('Confirm password', 'NewPassword123!'); fill('Verification code', '654321'); click('Reset password');
    expect(await screen.findByRole('status')).toHaveTextContent(en.customerAuth.resetSuccess);
    expect(auth.resetPassword).toHaveBeenCalledWith({ challenge: 'recovery', code: '654321', password: 'NewPassword123!' });
  });
  it('rejects invalid phone, weak/mismatched passwords and unsafe return destinations', async () => {
    mount('sign-up', { returnTo: 'https://untrusted.example' }); click('Create account'); expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.INVALID_PHONE);
    fill('Your name', 'Test Customer'); fill('Mobile number', '50000099'); fill('Password', 'weak'); fill('Confirm password', 'weak'); click('Create account'); expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.WEAK_PASSWORD);
    fill('Password', 'StrongPassword123!'); fill('Confirm password', 'DifferentPassword123!'); click('Create account'); expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.PASSWORD_MISMATCH);
    expect(customerAuthService.requestSignup).not.toHaveBeenCalled();
  });
  it('handles a reset URL without a code and renders Arabic correctly', async () => {
    mount('reset-password'); expect(screen.getByText(/Request a new recovery code/)).toBeInTheDocument();
    await i18n.changeLanguage('ar'); await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.customerAuth.titles['reset-password']));
    expect(screen.getByRole('heading', { level: 1 }).closest('.customer-booking')).toHaveAttribute('dir', 'rtl');
  });
});
