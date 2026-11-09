import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';
import Services from './Services';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../services/packages.service', () => ({ packagesService: { list: vi.fn(), manage: vi.fn() } }));

const state = vi.hoisted(() => ({ branchServices: [], selectedBranch: { id: 'shop', name: 'My Shop' }, selectedBranchId: 'shop', addService: vi.fn(), updateService: vi.fn(), deleteService: vi.fn() }));
vi.mock('../context/AppContext', () => ({ useApp: () => state }));
vi.mock('../components/UI/Modal', () => ({ default: ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null }));

beforeEach(() => {
  state.selectedBranch = { id: 'shop', name: 'My Shop' };
  state.selectedBranchId = 'shop';
  state.branchServices = [];
  state.updateService.mockReset().mockResolvedValue({ id: 'haircut' });
  state.addService.mockReset().mockResolvedValue({ id: 'haircut' });
});
afterEach(cleanup);
async function mount(language = 'en') {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
  render(<I18nextProvider i18n={i18n}><MemoryRouter><Services /></MemoryRouter></I18nextProvider>);
}
function submit(language = 'en') {
  const text = language === 'en' ? en : ar;
  fireEvent.click(screen.getByRole('button', { name: text.services.addService }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(dialog.querySelector('input[name="name"]'), { target: { value: 'Haircut' } });
  fireEvent.change(dialog.querySelector('input[name="price"]'), { target: { value: '3' } });
  fireEvent.submit(dialog.querySelector('form'));
}

it('disables service creation and explains a missing selection even when the header can display a shop', async () => {
  state.selectedBranchId = null;
  await mount();
  expect(screen.getByRole('alert')).toHaveTextContent(en.services.selectShopFirst);
  expect(screen.getByRole('button', { name: en.services.addService })).toBeDisabled();
  expect(screen.getByRole('button', { name: en.services.addFirstService })).toBeDisabled();
  expect(state.addService).not.toHaveBeenCalled();
});

it.each(['en', 'ar'])('shows actionable guidance if shop access changes before submission (%s)', async language => {
  state.addService.mockRejectedValue(new Error('SHOP_REQUIRED'));
  await mount(language); submit(language);
  expect(await screen.findByRole('alert')).toHaveTextContent((language === 'en' ? en : ar).services.selectShopFirst);
  expect(screen.getByRole('dialog').querySelector('input[name="name"]')).toHaveValue('Haircut');
});

it('submits the requested haircut and closes the form after it saves', async () => {
  await mount(); submit();
  expect(state.addService).toHaveBeenCalledWith({ name: 'Haircut', nameAr: '', description: '', duration: 30, price: 3 });
  await screen.findByRole('button', { name: en.services.addService });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('saves an optional Arabic name and restores it when editing', async () => {
  state.branchServices = [{ id: 'haircut', name: 'Haircut', nameAr: 'قص شعر', duration: 30, price: 3 }];
  await mount();
  fireEvent.click(screen.getByRole('button', { name: en.services.editService }));
  const input = screen.getByLabelText(en.services.nameAr);
  expect(input).toHaveValue('قص شعر');
  expect(input).toHaveAttribute('dir', 'rtl');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.submit(screen.getByRole('dialog').querySelector('form'));
  expect(state.updateService).toHaveBeenCalledWith('haircut', { name: 'Haircut', nameAr: '', description: '', duration: 30, price: 3 });
});

it.each(['en', 'ar'])('searches both service names and falls back for missing Arabic names (%s)', async language => {
  state.branchServices = [
    { id: 'haircut', name: 'Haircut', nameAr: 'قص شعر', duration: 30, price: 3 },
    { id: 'beard', name: 'Beard trim', nameAr: null, duration: 15, price: 2 },
  ];
  await mount(language);
  expect(screen.getByRole('heading', { name: language === 'ar' ? 'قص شعر' : 'Haircut' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Beard trim' })).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText((language === 'ar' ? ar : en).services.searchPlaceholder), { target: { value: 'قص' } });
  expect(screen.getByRole('heading', { name: language === 'ar' ? 'قص شعر' : 'Haircut' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Beard trim' })).not.toBeInTheDocument();
});
