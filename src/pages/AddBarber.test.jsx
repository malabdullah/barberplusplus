import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import AddBarber from './AddBarber';

const state = vi.hoisted(() => ({ addBarber: vi.fn(), selectedBranch: { id: 'shop', name: 'QA Shop' }, selectedBranchId: 'shop', branchServices: [] }));
vi.mock('../context/AppContext', () => ({ useApp: () => state }));
vi.mock('../hooks/useGeoLocation', () => ({ useGeoLocation: () => ({ dialCode: '+965' }) }));
let i18n;
beforeEach(async () => {
  state.selectedBranch = { id: 'shop', name: 'QA Shop' }; state.selectedBranchId = 'shop';
  state.addBarber.mockReset().mockResolvedValue({ id: 'new-barber' });
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);
function mount() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/dashboard/barbers/new']}><Routes><Route path="/dashboard/barbers/new" element={<AddBarber />} /><Route path="/dashboard/barbers" element={<h1>Barber list</h1>} /></Routes></MemoryRouter></I18nextProvider>);
}
function fill() {
  fireEvent.change(screen.getByLabelText(en.common.fullName), { target: { value: '  QA Barber  ' } });
  fireEvent.change(screen.getByLabelText(en.common.email), { target: { value: ' QA@example.test ' } });
  fireEvent.change(screen.getByLabelText(en.common.phone), { target: { value: '59998721' } });
}
it('shows a duplicate phone error beside the field, focuses it, and lets a corrected submission succeed', async () => {
  state.addBarber.mockRejectedValueOnce(new Error('PHONE_IN_USE'));
  mount(); fill(); fireEvent.click(screen.getByRole('button', { name: en.barbers.addBarber }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.phoneInUse);
  expect(screen.getByLabelText(en.common.phone)).toHaveFocus();
  expect(screen.getByLabelText(en.common.phone)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(en.common.fullName)).toHaveValue('  QA Barber  ');
  fireEvent.change(screen.getByLabelText(en.common.phone), { target: { value: '59998722' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: en.barbers.addBarber }));
  await screen.findByRole('heading', { name: 'Barber list' });
  expect(state.addBarber).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'QA Barber', email: 'qa@example.test', phone: '59998722' }));
});
it('prevents a create request without a selected shop and explains how to proceed', () => {
  state.selectedBranch = null; state.selectedBranchId = null; mount();
  expect(screen.getByRole('alert')).toHaveTextContent(en.barbers.selectShopFirst);
  expect(screen.getByRole('button', { name: en.barbers.addBarber })).toBeDisabled();
  expect(state.addBarber).not.toHaveBeenCalled();
});
it('makes a general server error visible and restores the submit button', async () => {
  state.addBarber.mockRejectedValue(new Error('network failure')); mount(); fill();
  fireEvent.click(screen.getByRole('button', { name: en.barbers.addBarber }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(en.errors.createBarberFailed); expect(alert).toHaveFocus();
  expect(screen.getByRole('button', { name: en.barbers.addBarber })).toBeEnabled();
});
it('validates empty fields and blocks additional clicks while creating', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: en.barbers.addBarber }));
  await waitFor(() => expect(screen.getByLabelText(en.common.fullName)).toHaveFocus());
  expect(state.addBarber).not.toHaveBeenCalled();
  fill(); state.addBarber.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: en.barbers.addBarber }));
  expect(screen.getByRole('button', { name: en.common.loading })).toBeDisabled();
  expect(state.addBarber).toHaveBeenCalledTimes(1);
});
