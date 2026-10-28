import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '../i18n/locales/en.json';
import ar from '../i18n/locales/ar.json';

const runtime = vi.hoisted(() => ({ isStaging: true, appConfig: {} }));
vi.mock('../lib/runtimeConfig', () => runtime);
import EnvironmentBanner from './EnvironmentBanner';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--environment-banner-height');
  runtime.isStaging = true;
  runtime.appConfig = {};
});
describe('Test environment indicator', () => {
  it.each([
    ['test', 'en', 'TEST — synthetic data'],
    ['test', 'ar', 'بيئة اختبار — بيانات تجريبية'],
    ['staging', 'en', 'STAGING — synthetic data'],
    ['staging', 'ar', 'بيئة مراجعة قبل النشر — بيانات تجريبية'],
  ])('labels cloud %s in %s independently of transport', async (profile, language, label) => {
    runtime.isStaging = false;
    runtime.appConfig = { cloudProfile: profile };
    const i18n = createInstance();
    await i18n.init({ lng: language, resources: { en: { translation: en }, ar: { translation: ar } } });
    render(<I18nextProvider i18n={i18n}><EnvironmentBanner /></I18nextProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
  });
  it('keeps the banner absent in production', async () => {
    runtime.isStaging = false;
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    render(<I18nextProvider i18n={i18n}><EnvironmentBanner /></I18nextProvider>);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it.each([['en', 'TEST — synthetic data'], ['ar', 'بيئة اختبار — بيانات تجريبية']])('labels synthetic data in %s and preserves noindex', async (language, label) => {
    const i18n = createInstance(); await i18n.init({ lng: language, resources: { en: { translation: en }, ar: { translation: ar } } });
    render(<I18nextProvider i18n={i18n}><EnvironmentBanner /></I18nextProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
  });
  it('measures wrapped banner height, reacts to resizing and restores the prior offset', async () => {
    let resize; const disconnect = vi.fn(); let height = 34;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }));
    document.documentElement.style.setProperty('--environment-banner-height', '7px');
    const i18n = createInstance(); await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const { unmount } = render(<I18nextProvider i18n={i18n}><EnvironmentBanner /></I18nextProvider>);
    expect(document.documentElement.style.getPropertyValue('--environment-banner-height')).toBe('34px');
    height = 62;
    act(() => resize());
    expect(document.documentElement.style.getPropertyValue('--environment-banner-height')).toBe('62px');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(document.documentElement.style.getPropertyValue('--environment-banner-height')).toBe('7px');
  });
});
