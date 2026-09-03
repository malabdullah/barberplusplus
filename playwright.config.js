import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    extraHTTPHeaders: process.env.ACCESS_CLIENT_ID ? {
      'CF-Access-Client-Id': process.env.ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.ACCESS_CLIENT_SECRET,
    } : undefined,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_APP_ENV: 'development',
      VITE_APP_URL: 'http://127.0.0.1:4173',
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYW5vbiJ9.signature',
    },
  },
});
