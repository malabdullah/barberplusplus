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
  vi.stubGlobal('matchMedia', () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Destination({ busy = false }) {
  usePublicNavigationBusy(busy);
  const location = useLocation();
  return <main><h1>{location.pathname}</h1><output>{location.state?.returnTo}</output></main>;
}
function mount(path = '/', busy = false) {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[path]}><Routes><Route element={<PublicLayout />}><Route path="*" element={<Destination busy={busy} />} /></Route></Routes></MemoryRouter></I18nextProvider>);
}
const header = () => within(screen.getByRole('banner'));
function openShops() { fireEvent.click(header().getByRole('button', { name: 'Shops', exact: true })); return header().getByRole('group', { name: 'Shops' }); }

describe('simple public navigation', () => {
  it('keeps customer actions direct and shop actions grouped, preserving the booking return', () => {
    mount('/book');
    expect(header().queryByRole('link', { name: 'Home', exact: true })).not.toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Book appointment', exact: true })).toHaveAttribute('href', '/book');
    const shops = openShops();
    expect(within(shops).getByRole('link', { name: 'Team sign in' })).toHaveAttribute('href', '/login');
    expect(within(shops).getByRole('link', { name: 'Register your shop' })).toHaveAttribute('href', '/signup');
    fireEvent.click(header().getByRole('link', { name: 'Customer sign in' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/customer/sign-in');
    expect(screen.getByRole('status')).toHaveTextContent('/book');
    expect(header().queryByRole('group', { name: 'Shops' })).not.toBeInTheDocument();
  });
  it.each([['admin','/admin'],['manager','/dashboard'],['agent','/agent'],['barber','/barber']])('takes signed-in %s back to the correct workspace', (role, path) => {
    state.isAuthenticated = true; state.userRole = role;
    mount();
    const shops = openShops();
    expect(within(shops).getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', path);
    expect(within(shops).queryByRole('link', { name: 'Register your shop' })).not.toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Customer sign in' })).toBeInTheDocument();
  });
  it('keeps customer and staff destinations available when both sessions are present', () => {
    state.customer = { name: 'Customer' }; state.isAuthenticated = true; state.userRole = 'manager'; mount();
    fireEvent.click(header().getByRole('button', { name: 'My account', exact: true }));
    expect(within(header().getByRole('group', { name: 'My account' })).getByRole('link', { name: 'My appointments' })).toHaveAttribute('href', '/customer/account#appointments');
    const shops = openShops();
    expect(header().queryByRole('group', { name: 'My account' })).not.toBeInTheDocument();
    expect(within(shops).getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', '/dashboard');
  });
  it('closes disclosures with Escape and restores focus', () => {
    mount('/customer/sign-in');
    openShops(); fireEvent.keyDown(document, { key: 'Escape' });
    expect(header().getByRole('button', { name: 'Shops', exact: true })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  });
  it('makes a closing panel inert immediately while retaining it for its exit transition', () => {
    mount();
    const shops = openShops();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(shops).toHaveAttribute('inert', '');
    expect(shops).toHaveAttribute('aria-hidden', 'true');
    expect(header().queryByRole('link', { name: 'Team sign in' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const mobile = document.querySelector('.public-mobile-menu');
    expect(mobile).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(mobile).toHaveAttribute('inert', '');
    expect(mobile).toHaveAttribute('aria-hidden', 'true');
    expect(header().queryByRole('group', { name: 'Customers' })).not.toBeInTheDocument();
  });
  it('shows both audience groups and all four mobile links without nested disclosures', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const customers = header().getByRole('group', { name: 'Customers' });
    const shops = header().getByRole('group', { name: 'Shops' });
    expect(within(customers).getAllByRole('link')).toHaveLength(2);
    expect(within(shops).getAllByRole('link')).toHaveLength(2);
    expect(within(customers).queryByRole('button')).not.toBeInTheDocument();
    expect(within(shops).queryByRole('button')).not.toBeInTheDocument();
  });
  it('guards direct navigation and preferences while saving', async () => {
    mount('/book', true);
    await waitFor(() => expect(header().getByRole('button', { name: 'Shops', exact: true })).toBeDisabled());
    expect(screen.getByRole('button', { name: en.preferences.selectLanguage })).toBeDisabled();
    const signIn = header().getByRole('link', { name: 'Customer sign in' });
    expect(signIn).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(signIn);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/book');
  });
  it('translates both mobile groups into Arabic', async () => {
    await i18n.changeLanguage('ar'); mount();
    fireEvent.click(screen.getByRole('button', { name: ar.publicNav.openMenu }));
    expect(header().getByRole('group', { name: ar.publicNav.customers })).toBeInTheDocument();
    expect(header().getByRole('group', { name: ar.publicNav.shops })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ar.publicNav.closeMenu })).toHaveAttribute('aria-expanded', 'true');
  });
});
