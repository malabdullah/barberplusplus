import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '../../i18n/locales/en.json';
import ar from '../../i18n/locales/ar.json';
import CityPicker from './CityPicker';

let i18n, onChange;
const groups = [{ key: 'capital', name: 'Al Asimah (Capital)', nameAr: 'العاصمة', cities: ['Kuwait City'] }, { key: 'hawalli', name: 'Hawalli', nameAr: 'حولي', cities: ['Salmiya'] }];
beforeEach(async () => {
  i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ar: { translation: ar } } });
  onChange = vi.fn();
});
afterEach(cleanup);
function setup(value = '') {
  render(<I18nextProvider i18n={i18n}><CityPicker groups={groups} value={value} onChange={onChange}
    cityName={city => i18n.t(`customerBooking.cities.${city}`)}
    governorateName={group => i18n.language === 'ar' ? group.nameAr : group.name} /></I18nextProvider>);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  return input;
}

it('makes governorates non-selectable headings and filters city choices by city or governorate', () => {
  const input = setup();
  fireEvent.mouseDown(screen.getByText('Al Asimah (Capital)'));
  fireEvent.click(screen.getByText('Al Asimah (Capital)'));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getAllByRole('option')).toHaveLength(2);
  fireEvent.change(input, { target: { value: 'Sal' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('option')).toHaveTextContent('Salmiya');
  fireEvent.change(input, { target: { value: 'Hawalli' } });
  fireEvent.click(screen.getByRole('option', { name: 'Salmiya' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Salmiya');
});

it('moves the active option through cities only and confirms with Enter', () => {
  const input = setup();
  expect(input).toHaveAttribute('aria-activedescendant', 'booking-city-option-0');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).toHaveAttribute('aria-activedescendant', 'booking-city-option-1');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Salmiya');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('preserves the chosen city when an empty search is dismissed with Escape, Tab or an outside click', () => {
  const input = setup('Kuwait City');
  for (const action of ['Escape', 'Tab', 'outside']) {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Missing city' } });
    expect(screen.getByRole('status')).toHaveTextContent('No matching cities');
    if (action === 'outside') fireEvent.pointerDown(document.body);
    else fireEvent.keyDown(input, { key: action });
    expect(input).toHaveValue('Kuwait City');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  }
  expect(onChange).not.toHaveBeenCalled();
});

it('supports Arabic city and governorate names while preserving the city value', async () => {
  await i18n.changeLanguage('ar');
  const input = setup();
  expect(screen.getAllByText('المحافظة')).toHaveLength(2);
  fireEvent.change(input, { target: { value: 'حولي' } });
  fireEvent.click(screen.getByRole('option', { name: 'السالمية' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Salmiya');
});
