import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import Dashboard from './Dashboard';

const state = vi.hoisted(() => ({}));
vi.mock('../context/AppContext', () => ({ useApp: () => state }));
let i18n;
beforeEach(async () => {
  Object.assign(state, { userRole: 'manager', branches: [], selectedBranch: null, branchBookings: [], branchBarbers: [], branchServices: [], metrics: { todayTotal: 0, todayCompleted: 0, todayUpcoming: 0, weekRevenue: 0, weekBookings: 0, totalBarbers: 0, totalServices: 0 } });
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } } });
});
afterEach(cleanup);
const mount = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><Dashboard /></MemoryRouter></I18nextProvider>);
it.each(['en', 'ar'])('directs a new manager to shop creation before booking controls in %s', async language => {
  await i18n.changeLanguage(language); mount();
  const copy = language === 'ar' ? ar : en;
  expect(screen.getByRole('heading', { name: copy.managerOnboarding.welcome })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.branches.addFirstBranch })).toHaveAttribute('href', '/dashboard/setup?shop=new');
  expect(screen.queryByRole('link', { name: copy.bookings.newBooking })).not.toBeInTheDocument();
});
it('retains the normal dashboard once a manager has a shop', () => {
  state.branches = [{ id: 'shop', name: 'My Shop' }]; state.selectedBranch = state.branches[0]; mount();
  expect(screen.queryByRole('heading', { name: en.managerOnboarding.welcome })).not.toBeInTheDocument();
  expect(screen.getByText(en.dashboard.welcomeMessage.replace('{{branch}}', 'My Shop'))).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: en.bookings.newBooking }).length).toBeGreaterThan(0);
});
