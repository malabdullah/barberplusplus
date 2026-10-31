import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import CustomerSocialAuth from './CustomerSocialAuth';
import { customerAuthService } from '../services/customerAuth.service';
const auth = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../context/CustomerAuthContext', () => ({ useCustomerAuth: () => ({ customer: null, ...auth }) }));
vi.mock('../context/AppContext', () => ({ useApp: () => ({ setLanguage: vi.fn() }) }));
vi.mock('../services/customerAuth.service', () => ({ customerAuthService: { finishSocial: vi.fn(), socialStatus: vi.fn(), ensureEmailProfile: vi.fn() } }));
let i18n;
beforeEach(async () => {
  vi.resetAllMocks();
  customerAuthService.socialStatus.mockResolvedValue({ profile: null, name: 'Social Customer' });
  customerAuthService.ensureEmailProfile.mockResolvedValue({ id: 'customer' });
  i18n = i18next.createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
});
afterEach(cleanup);
function mount(path = '/customer/complete-profile') {
  render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[{ pathname: path, state: { returnTo: '/book' } }]}><Routes>
    <Route path="/customer/complete-profile" element={<CustomerSocialAuth />} /><Route path="/customer/auth-callback" element={<CustomerSocialAuth />} />
    <Route path="/book" element={<h1>Booking destination</h1>} /><Route path="/customer/account" element={<h1>Account destination</h1>} />
  </Routes></MemoryRouter></I18nextProvider>);
}
it('asks only for a missing provider name and continues without a phone', async () => {
  customerAuthService.socialStatus.mockResolvedValue({ profile: null, name: '' });
  customerAuthService.ensureEmailProfile.mockResolvedValueOnce({ needsName: true }).mockResolvedValueOnce({ id: 'customer' });
  mount(); fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Social Customer' } });
  expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: en.customerAuth.email.continue }));
  await screen.findByText('Booking destination');
  expect(customerAuthService.ensureEmailProfile).toHaveBeenLastCalledWith('Social Customer'); expect(auth.refresh).toHaveBeenCalled();
});
it('uses the provider name without asking for phone', async () => {
  mount(); await screen.findByText('Booking destination');
  expect(customerAuthService.ensureEmailProfile).toHaveBeenCalledWith('Social Customer');
});
it('returns an already completed social customer directly to booking', async () => {
  customerAuthService.socialStatus.mockResolvedValue({ profile: { id: 'linked-customer' } });
  mount(); await screen.findByText('Booking destination');
  expect(customerAuthService.ensureEmailProfile).not.toHaveBeenCalled();
});
it('does not expose profile completion after a rejected callback', async () => {
  customerAuthService.finishSocial.mockRejectedValue(new Error('SOCIAL_SIGN_IN_FAILED'));
  mount('/customer/auth-callback'); await screen.findByRole('alert');
  expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();
  expect(customerAuthService.socialStatus).not.toHaveBeenCalled();
});
