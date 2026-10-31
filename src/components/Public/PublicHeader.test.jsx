import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../../i18n/locales/en.json';
import ar from '../../i18n/locales/ar.json';
import PublicLayout from './PublicLayout';
import { usePublicNavigationBusy } from './PublicNavigationContext';

const state = vi.hoisted(() => ({ isAuthenticated: false, userRole: null, customer: null }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ ...state, language: 'en', theme: 'dark', setLanguage: vi.fn(), setTheme: vi.fn() }) }));
vi.mock('../../context/CustomerAuthContext', () => ({ useCustomerAuth: () => ({ customer: state.customer }) }));
vi.mock('../../lib/runtimeConfig', () => ({ customerFeaturesEnabled: true }));
let i18n;
beforeEach(async () => {
  state.isAuthenticated = false; state.userRole = null; state.customer = null;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Destination({ busy = false }) {
  usePublicNavigationBusy(busy);
  const location = useLocation();
  return <main><h1>{location.pathname}</h1><output>{location.state?.returnTo}</output></main>;
}
function mount(path = '/', busy = false) {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[path]}><Routes><Route element={<PublicLayout />}><Route path="*" element={<Destination busy={busy} />} /></Route></Routes></MemoryRouter></I18nextProvider>);
}
function openAccount() { fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true })); return screen.getByRole('navigation', { name: 'Account options' }); }

describe('unified public navigation', () => {
  it('separates customer and shop team entry points and preserves the booking return', () => {
    mount('/book');
    const account = openAccount();
    expect(within(account).getByRole('link', { name: 'Shop team sign-in' })).toHaveAttribute('href', '/login');
    fireEvent.click(within(account).getByRole('link', { name: 'Customer sign-in' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/customer/sign-in');
    expect(screen.getByRole('status')).toHaveTextContent('/book');
    expect(screen.queryByRole('navigation', { name: 'Account options' })).not.toBeInTheDocument();
  });
  it.each([['admin','/admin'],['manager','/dashboard'],['agent','/agent'],['barber','/barber']])('takes signed-in %s back to the correct workspace', (role, path) => {
    state.isAuthenticated = true; state.userRole = role;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace', exact: true }));
    expect(within(screen.getByRole('navigation', { name: 'Account options' })).getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/');
  });
  it('keeps customer and staff destinations available when both sessions are present', () => {
    state.customer = { name: 'Customer' }; state.isAuthenticated = true; state.userRole = 'manager'; mount();
    fireEvent.click(screen.getByRole('button', { name: 'My account', exact: true }));
    const account = screen.getByRole('navigation', { name: 'Account options' });
    expect(within(account).getByRole('link', { name: 'My appointments' })).toHaveAttribute('href', '/customer/account#appointments');
    expect(within(account).getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', '/dashboard');
  });
  it('uses real cross-page links and closes disclosures with Escape, restoring focus', () => {
    mount('/customer/sign-in');
    expect(screen.getAllByRole('link', { name: 'For shops', exact: true })[0]).toHaveAttribute('href', '/#for-shops');
    openAccount(); fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
    expect(screen.queryByText('Close menu')).not.toBeInTheDocument();
  });
  it('guards navigation and preferences while a request is saving', async () => {
    mount('/book', true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled());
    expect(screen.getByRole('button', { name: en.preferences.selectLanguage })).toBeDisabled();
    const home = screen.getAllByRole('link', { name: 'Home', exact: true })[0];
    expect(home).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(home);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/book');
  });
  it('translates the complete mobile navigation into Arabic', async () => {
    await i18n.changeLanguage('ar'); mount();
    fireEvent.click(screen.getByRole('button', { name: ar.publicNav.openMenu }));
    expect(screen.getAllByRole('link', { name: ar.publicNav.customerSignIn }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: ar.publicNav.closeMenu })).toHaveAttribute('aria-expanded', 'true');
  });
});
