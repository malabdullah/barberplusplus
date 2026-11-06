import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import Signup from './Signup';
const signup = vi.hoisted(() => vi.fn());
const verification = vi.hoisted(() => ({ status: vi.fn(), resend: vi.fn() }));
vi.mock('../services/registration.service', () => ({ registrationService: verification }));
vi.mock('../context/AppContext', () => ({ useApp: () => ({ signup }) }));
let i18n;
beforeEach(async () => {
  sessionStorage.clear();
  verification.status.mockReset().mockResolvedValue({ verified: false }); verification.resend.mockReset().mockResolvedValue({ verified: false, resent: true, receipt: 'renewed', expiresAt: Date.now()+86400000, resendAt: Date.now()+60000 });
  signup.mockReset().mockResolvedValue({ success: true, confirmationRequired: true, email: 'manager-qa@example.test', receipt: 'signed-receipt', expiresAt: Date.now()+86400000, resendAt: Date.now()-1 });
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
it.each(['en', 'ar'])('shows a focused existing-account error and sign-in link in %s, preserving the form', async language => {
  await i18n.changeLanguage(language);
  signup.mockResolvedValue({ success: false, error: 'SIGNUP_EMAIL_EXISTS' });
  render(<I18nextProvider i18n={i18n}><MemoryRouter><Signup /></MemoryRouter></I18nextProvider>);
  for (const [id, value] of Object.entries({ name: 'QA Manager', email: 'linked@example.test', phone: '59998723', password: 'Synthetic12!', confirmPassword: 'Synthetic12!' })) fireEvent.change(document.getElementById(id), { target: { value } });
  const copy = language === 'ar' ? ar : en;
  fireEvent.click(screen.getByRole('button', { name: copy.auth.createAccount }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(copy.auth.registrationEmailLinked); expect(alert).toHaveFocus();
  expect(screen.queryByText(copy.auth.registrationConfirmNext)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.auth.registrationExistingSignIn })).toHaveAttribute('href', '/login');
  expect(document.getElementById('email')).toHaveValue('linked@example.test');
  expect(screen.getByRole('button', { name: copy.auth.createAccount })).toBeEnabled();
  fireEvent.change(document.getElementById('email'), { target: { value: 'new@example.test' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
afterEach(cleanup);
it('explains email confirmation and sign-in instead of opening the manager dashboard', async () => {
  render(<I18nextProvider i18n={i18n}><MemoryRouter><Signup /></MemoryRouter></I18nextProvider>);
  for (const [id, value] of Object.entries({ name: 'QA Manager', email: 'manager-qa@example.test', phone: '59998723', password: 'Synthetic12!', confirmPassword: 'Synthetic12!' })) {
    fireEvent.change(document.getElementById(id), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));
  await screen.findByRole('heading', { name: en.auth.registrationNextTitle });
  expect(screen.getByText(en.auth.registrationConfirmNext)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: en.auth.signIn }).every(link => link.getAttribute('href') === '/login')).toBe(true);
  expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument();
});

async function register() {
  render(<I18nextProvider i18n={i18n}><MemoryRouter><Signup /></MemoryRouter></I18nextProvider>);
  for (const [id,value] of Object.entries({name:'QA Manager',email:'manager-qa@example.test',phone:'59998741',password:'Synthetic12!',confirmPassword:'Synthetic12!'})) fireEvent.change(document.getElementById(id),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:en.auth.createAccount}));
  await screen.findByRole('button',{name:en.auth.registrationCheck});
}
it('checks pending and verified states, then stops resends and offers sign-in',async()=>{
  await register();
  fireEvent.click(screen.getByRole('button',{name:en.auth.registrationCheck}));
  expect(await screen.findByRole('status')).toHaveTextContent(en.auth.registrationNotVerified);
  verification.status.mockResolvedValue({verified:true});
  fireEvent.click(screen.getByRole('button',{name:en.auth.registrationCheck}));
  await screen.findByRole('heading',{name:en.auth.registrationVerifiedTitle});
  expect(screen.queryByRole('button',{name:en.auth.registrationResend})).not.toBeInTheDocument();
  expect(sessionStorage.getItem('barber-pending-manager-registration')).toBeNull();
});
it('resends with feedback and cooldown, and preserves a receipt but never passwords across refresh',async()=>{
  await register();
  const stored=JSON.parse(sessionStorage.getItem('barber-pending-manager-registration'));
  expect(stored).toMatchObject({receipt:'signed-receipt',email:'manager-qa@example.test'});expect(JSON.stringify(stored)).not.toContain('Synthetic12!');
  fireEvent.click(screen.getByRole('button',{name:en.auth.registrationResend}));
  expect(await screen.findByRole('status')).toHaveTextContent(en.auth.registrationResent);
  expect(screen.getByRole('button',{name:/Resend verification email \(60s\)/})).toBeDisabled();
  cleanup();
  render(<I18nextProvider i18n={i18n}><MemoryRouter><Signup /></MemoryRouter></I18nextProvider>);
  expect(screen.getByRole('button',{name:en.auth.registrationCheck})).toBeInTheDocument();
  expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument();
});
it('shows check failures, permits retry, and disables expired receipts',async()=>{
  await register();verification.status.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('REGISTRATION_EXPIRED'));
  fireEvent.click(screen.getByRole('button',{name:en.auth.registrationCheck}));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.registrationCheckFailed);
  fireEvent.click(screen.getByRole('button',{name:en.auth.registrationCheck}));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.registrationExpired);
  expect(screen.getByRole('button',{name:en.auth.registrationCheck})).toBeDisabled();
});
