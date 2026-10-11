import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testMatch: /navigation\.spec\.js/,
  // Projects share synthetic profile settings, so serialize their UI changes.
  workers: 1,
  retries: 0,
  use: { ...base.use, trace: 'off', video: 'off' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
});
