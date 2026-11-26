import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '../../i18n/locales/en.json';
import ar from '../../i18n/locales/ar.json';
import CitySelection from './CitySelection';

const groups = [
  { key: 'capital', name: 'Al Asimah (Capital)', nameAr: 'العاصمة', cities: ['Kuwait City', 'Mirqab', 'Sharq'] },
  { key: 'hawalli', name: 'Hawalli', nameAr: 'حولي', cities: ['Salmiya'] },
];
let i18n;
beforeEach(async () => {
  i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } } });
});
afterEach(cleanup);
function setup(props = {}) {
  const onApply = vi.fn();
  const view = render(<I18nextProvider i18n={i18n}><CitySelection groups={groups} selectedCities={[]}
    cityName={city => i18n.t(`customerBooking.cities.${city}`, { defaultValue: city })}
    governorateName={group => i18n.language === 'ar' ? group.nameAr : group.name} onApply={onApply} {...props} /></I18nextProvider>);
  return { ...view, onApply };
}

it('stages checked cities until submit and preserves hidden selections while searching', () => {
  const { onApply } = setup();
  expect(screen.getByRole('button', { name: 'Show shops' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kuwait City' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Shar' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sharq' }));
  expect(screen.getByText('2 cities selected')).toBeVisible();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Show shops' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith(['Kuwait City', 'Sharq']);
});

it('clears staged cities and search on a governorate change without applying a search', () => {
  const { onApply } = setup({ selectedCities: ['Kuwait City', 'Sharq'] });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Kuwait' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hawalli' } });
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.queryByRole('checkbox', { name: 'Kuwait City' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show shops' })).toBeDisabled();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Salmiya' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show shops' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith(['Salmiya']);
});

it('restores a selected governorate after filters arrive and renders a no-match state', () => {
  setup({ selectedCities: ['Salmiya'] });
  expect(screen.getByRole('combobox')).toHaveValue('hawalli');
  expect(screen.getByRole('checkbox', { name: 'Salmiya' })).toBeChecked();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Missing' } });
  expect(screen.getByRole('status')).toHaveTextContent('No matching cities');
  expect(screen.getByRole('button', { name: 'Show shops' })).toBeEnabled();
});

it('uses translated Arabic labels while submitting canonical city values', async () => {
  await i18n.changeLanguage('ar');
  const { onApply } = setup();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'مدينة' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'مدينة الكويت' }));
  fireEvent.click(screen.getByRole('button', { name: 'عرض الصالونات' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith(['Kuwait City']);
});
