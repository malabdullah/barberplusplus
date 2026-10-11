import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';

vi.mock('../lib/runtimeConfig', () => ({ isStaging: true }));
import EnvironmentBanner from './EnvironmentBanner';
afterEach(cleanup);
describe('Test environment indicator', () => {
  it.each([['en', 'TEST — synthetic data'], ['ar', 'بيئة اختبار — بيانات تجريبية']])('labels synthetic data in %s and preserves noindex', async (language, label) => {
    const i18n = createInstance(); await i18n.init({ lng: language, resources: { en: { translation: en }, ar: { translation: ar } } });
    render(<I18nextProvider i18n={i18n}><EnvironmentBanner /></I18nextProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
  });
});
