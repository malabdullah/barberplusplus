import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import CustomerEmailVerification from './CustomerEmailVerification';
import { customerAuthService } from '../services/customerAuth.service';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('../context/CustomerAuthContext', () => ({ useCustomerAuth: () => ({ refresh }) }));
vi.mock('../services/customerAuth.service', () => ({ customerAuthService: { verifyEmailCode: vi.fn(), ensureEmailProfile: vi.fn(), resendConfirmation: vi.fn(), requestRecovery: vi.fn() } }));
let i18n;
beforeEach(async () => {
  vi.resetAllMocks(); sessionStorage.clear();
  customerAuthService.ensureEmailProfile.mockResolvedValue({ name: 'Customer' });
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);
function mount(purpose = 'signup', state = { email: 'test@example.test', purpose, returnTo: '/book' }) {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[{ pathname: '/customer/verify-email', search: `?purpose=${purpose}`, state }]}><Routes><Route path="/customer/verify-email" element={<CustomerEmailVerification />} /><Route path="/customer/reset-password" element={<h1>Choose a new password</h1>} /></Routes></MemoryRouter></I18nextProvider>);
}
const verify = code => {
  fireEvent.change(screen.getByLabelText(en.customerAuth.email.codeLabel), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: en.customerAuth.email.verifyCode }));
};
it('keeps an incorrect-code error on the form, then confirms a valid code and offers the original booking', async () => {
  customerAuthService.verifyEmailCode.mockRejectedValueOnce(new Error('INVALID_CODE')).mockResolvedValueOnce();
  mount(); verify('000000');
  expect(await screen.findByRole('alert')).toHaveTextContent(en.customerAuth.errors.INVALID_CODE);
  verify('123456'); await screen.findByRole('heading', { name: en.customerAuth.email.verifiedTitle });
  expect(refresh).toHaveBeenCalled();
  expect(screen.getByRole('link', { name: en.customerAuth.bookNow })).toHaveAttribute('href', '/book');
});
it('accepts pasted Arabic digits and routes a recovery code to password reset', async () => {
  mount('recovery'); verify('١٢٣٤٥٦');
  await screen.findByRole('heading', { name: 'Choose a new password' });
  expect(customerAuthService.verifyEmailCode).toHaveBeenCalledWith({ email: 'test@example.test', code: '123456', purpose: 'recovery' });
  expect(customerAuthService.ensureEmailProfile).not.toHaveBeenCalled();
});
it('can request a new code after opening the verification page without a pending signup', async () => {
  mount('signup', null);
  fireEvent.change(screen.getByLabelText(en.customerAuth.email.label), { target: { value: 'test@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: en.customerAuth.email.resendCode }));
  await waitFor(() => expect(customerAuthService.resendConfirmation).toHaveBeenCalledWith({ email: 'test@example.test', returnTo: '/customer/account' }));
  expect(await screen.findByText(en.customerAuth.email.resent)).toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem('barber-customer-email-pending')).email).toBe('test@example.test');
});
