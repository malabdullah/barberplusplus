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
vi.mock('../context/AppContext', () => ({ useApp: () => ({ signup }) }));
let i18n;
beforeEach(async () => {
  signup.mockReset().mockResolvedValue({ success: true, confirmationRequired: true });
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
