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
vi.mock('../services/customerAuth.service', () => ({ customerAuthService: { requestSignup: vi.fn(), requestRecovery: vi.fn(), resendConfirmation: vi.fn(), socialProviders: vi.fn(), startSocial: vi.fn() } }));
let i18n;
beforeEach(async () => {
  vi.resetAllMocks();
  customerAuthService.socialProviders.mockResolvedValue({ google: false, apple: false });
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
  it('registers by email without asking for a phone and offers to resend confirmation', async () => {
    mount('sign-up', { returnTo: '/book' });
    fill('Your name', 'Test Customer'); fill(en.customerAuth.email.label, 'test@example.test');
    expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();
    fill('Password', 'Short12!'); fill('Confirm password', 'Short12!'); click('Create account');
    await screen.findByRole('status');
    expect(customerAuthService.requestSignup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Customer', email: 'test@example.test', password: 'Short12!', returnTo: '/book' }));
    click(en.customerAuth.email.resend); await waitFor(() => expect(customerAuthService.resendConfirmation).toHaveBeenCalled());
  });
  it('signs in by email and renders a friendly credential error', async () => {
    mount('sign-in'); fill(en.customerAuth.email.label, 'test@example.test'); fill('Password', 'incorrect');
    auth.login.mockRejectedValue(new Error('INVALID_LOGIN')); click('Sign in');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.customerAuth.errors.INVALID_LOGIN);
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@example.test', password: 'incorrect' }));
  });
  it('requests email recovery and resets only after a link', async () => {
    mount('forgot-password'); fill(en.customerAuth.email.label, 'test@example.test'); click(en.customerAuth.email.sendRecovery);
    await screen.findByRole('status'); expect(customerAuthService.requestRecovery).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@example.test' }));
    cleanup(); mount('reset-password', { recovery: true }); fill('New password', 'Newpass1!'); fill('Confirm password', 'Newpass1!'); click('Reset password');
    expect(await screen.findByRole('status')).toHaveTextContent(en.customerAuth.resetSuccess);
    expect(auth.resetPassword).toHaveBeenCalledWith({ password: 'Newpass1!' });
  });
  it('rejects invalid email and weak or mismatched passwords', async () => {
    mount('sign-up'); click('Create account'); expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.INVALID_DETAILS);
    fill('Your name', 'Test Customer'); fill(en.customerAuth.email.label, 'test@example.test'); fill('Password', 'weak'); fill('Confirm password', 'weak'); click('Create account'); expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.WEAK_PASSWORD);
    fill('Password', 'Short12!'); fill('Confirm password', 'Different12!'); click('Create account'); expect(screen.getByRole('alert')).toHaveTextContent(en.customerAuth.errors.PASSWORD_MISMATCH);
    expect(customerAuthService.requestSignup).not.toHaveBeenCalled();
  });
  it('handles a missing reset link and renders Arabic correctly', async () => {
    mount('reset-password'); expect(screen.getByText(en.customerAuth.email.invalidLink)).toBeInTheDocument();
    await i18n.changeLanguage('ar'); await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.customerAuth.titles['reset-password']));
    expect(screen.getByRole('heading', { level: 1 }).closest('.customer-booking')).toHaveAttribute('dir', 'rtl');
  });
});


it('shows provider availability and launches configured Google sign-in with the booking return', async () => {
  customerAuthService.socialProviders.mockResolvedValue({ google: true, apple: false });
  mount('sign-in', { returnTo: '/book' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeDisabled();
  click('Continue with Google');
  expect(customerAuthService.startSocial).toHaveBeenCalledWith('google', '/book');
});

it('does not launch unconfigured providers', async () => {
  mount('sign-up');
  expect(await screen.findByText(en.customerAuth.social.unavailable)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeDisabled();
});
