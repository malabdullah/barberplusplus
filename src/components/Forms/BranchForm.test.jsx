import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '../../i18n/locales/en.json';
import BranchForm from './BranchForm';

vi.mock('../../services', () => ({ locationsService: { getGovernoratesWithAreas: async () => [{ id: 1, name_en: 'Capital', areas: [{ id: 10, name_en: 'Sharq' }] }] } }));
vi.mock('../../hooks/useGeoLocation', () => ({ useGeoLocation: () => ({ dialCode: '+965' }) }));
afterEach(cleanup);
async function mount() {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  const save = vi.fn();
  render(<I18nextProvider i18n={i18n}><BranchForm onSubmit={save} onCancel={() => {}} /></I18nextProvider>);
  await screen.findByRole('option', { name: 'Capital' });
  fireEvent.change(screen.getByLabelText(en.branches.name), { target: { value: 'QA Shop' } });
  fireEvent.change(screen.getByLabelText(en.branches.governorate), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText(en.branches.area), { target: { value: '10' } });
  return save;
}
it('creates a shop without demanding a second phone number, map, image or manual staff count', async () => {
  const save = await mount();
  fireEvent.click(screen.getByRole('button', { name: en.branches.createBranch }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ phone: null, locationUrl: null, name: 'QA Shop' }));
  expect(screen.queryByLabelText(en.branches.numberOfBarbers)).not.toBeInTheDocument();
});
it('shows a useful error when closing time is before opening time', async () => {
  const save = await mount();
  fireEvent.change(screen.getByLabelText('Monday — Closing Time'), { target: { value: '08:00' } });
  fireEvent.click(screen.getByRole('button', { name: en.branches.createBranch }));
  expect(screen.getByRole('alert')).toHaveTextContent(en.managerAudit.invalidHours);
  expect(save).not.toHaveBeenCalled();
});
