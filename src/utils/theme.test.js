import { afterEach, expect, it, vi } from 'vitest';
import { resolveTheme } from './theme';

afterEach(() => vi.unstubAllGlobals());
it('resolves legacy System preferences while preserving explicit choices', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  expect(resolveTheme('system')).toBe('dark');
  expect(resolveTheme('light')).toBe('light');
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  expect(resolveTheme('system')).toBe('light');
  expect(resolveTheme('dark')).toBe('dark');
  expect(resolveTheme(null)).toBe('dark');
});
