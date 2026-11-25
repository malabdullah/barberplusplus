import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import JoinShop from './JoinShop';
import { readShopInvitation, rememberShopInvitation } from '../lib/shopInvitation';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn() }));
const api = vi.hoisted(() => ({ resolve: vi.fn(), accept: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth } }));
vi.mock('../lib/runtimeConfig', () => ({ appConfig: { appUrl: 'https://barber-test.alabdullah-cs.workers.dev' } }));
vi.mock('../services/customerAuth.service', () => ({ customerAuthService: { socialProviders: async () => ({ google: true, apple: true }) } }));
vi.mock('../services/barberInvitations.service', () => ({ barberInvitationsService: api }));
vi.mock('../components/Customer/CustomerAuthLayout', () => ({ default: ({ children }) => <section>{children}</section> }));
const invite = { id: '12345678-1234-4234-8234-123456789012', token: 'a'.repeat(64) };
const details = { email: 'invited@example.test', kind: 'new', shop: 'Invitation QA shop', signed_in: false };
let i18n;
beforeEach(async () => {
  vi.resetAllMocks(); sessionStorage.clear();
  window.history.replaceState(null, '', '/accept-invite?invitation=' + invite.id + '#token=' + invite.token);
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signInWithOAuth.mockResolvedValue({ error: null }); auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  api.resolve.mockResolvedValue({ ...details });
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); });
const mount = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><JoinShop /></MemoryRouter></I18nextProvider>);

it('offers both providers and password registration to a new invited barber', async () => {
  mount();
  await waitFor(() => expect(screen.getByRole('button', { name: en.customerAuth.social.google })).toBeEnabled());
  expect(screen.getByRole('button', { name: en.customerAuth.social.apple })).toBeEnabled();
  expect(screen.getByLabelText(en.auth.password)).toBeVisible();
  expect(screen.getByLabelText(en.auth.confirmPassword)).toBeVisible();
  expect(api.accept).not.toHaveBeenCalled();
});
for (const provider of ['google', 'apple']) it('preserves the invitation privately before starting ' + provider, async () => {
  mount(); const button = await screen.findByRole('button', { name: en.customerAuth.social[provider] });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider, options: { redirectTo: 'https://barber-test.alabdullah-cs.workers.dev/accept-invite' } }));
  expect(screen.getByRole('button', { name: en.barberInvitations.joining })).toBeDisabled();
  window.history.replaceState(null, '', '/accept-invite?code=synthetic-code');
  expect(readShopInvitation()).toEqual(invite);
  expect(JSON.stringify(auth.signInWithOAuth.mock.calls)).not.toContain(invite.token);
  expect(api.accept).not.toHaveBeenCalled();
});

it('returns a cancelled provider flow to the invitation with retry and email options', async () => {
  rememberShopInvitation(invite); window.history.replaceState(null, '', '/accept-invite?error=access_denied');
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(en.barberInvitations.errors.SOCIAL_FAILED);
  await waitFor(() => expect(screen.getByRole('button', { name: en.customerAuth.social.google })).toBeEnabled());
  expect(screen.getByLabelText(en.auth.password)).toBeVisible();
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled(); expect(api.accept).not.toHaveBeenCalled();
  expect(window.location.search).not.toContain('error');
});

it('uses the matching OAuth account without asking it to create another password', async () => {
  rememberShopInvitation(invite); window.history.replaceState(null, '', '/accept-invite?code=synthetic-code');
  auth.getSession.mockResolvedValue({ data: { session: { user: { email: details.email } } } });
  api.resolve.mockResolvedValue({ ...details, kind: 'customer', signed_in: true });
  mount();
  expect(await screen.findByLabelText(en.common.fullName)).toBeVisible();
  expect(screen.queryByLabelText(en.auth.password)).toBeNull();
  expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  expect(window.location.search).not.toContain('code');
  expect(api.accept).not.toHaveBeenCalled();
});

it('blocks joining with a different signed-in provider email', async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { email: 'another@example.test' } } } });
  api.resolve.mockResolvedValue({ ...details, kind: 'customer', signed_in: false });
  mount(); expect(await screen.findByRole('button', { name: en.barberInvitations.switchAccount })).toBeEnabled();
  expect(screen.queryByRole('button', { name: en.barberInvitations.accept })).toBeNull();
  expect(api.accept).not.toHaveBeenCalled();
});

it('does not offer social signup for an expired invitation', async () => {
  api.resolve.mockRejectedValue(new Error('INVITE_EXPIRED')); mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(en.barberInvitations.errors.INVITE_EXPIRED);
  expect(screen.queryByRole('button', { name: en.customerAuth.social.google })).toBeNull();
  expect(auth.signInWithOAuth).not.toHaveBeenCalled();
});

it('refuses OAuth if tab storage cannot retain the invitation', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  mount(); const button = await screen.findByRole('button', { name: en.customerAuth.social.google });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent(en.customerAuth.errors.SOCIAL_SIGN_IN_FAILED);
  expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  expect(screen.getByLabelText(en.auth.password)).toBeEnabled();
});
