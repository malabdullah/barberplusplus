import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';

const localBrowser = loadEnv('development', process.cwd(), 'VITE_');
if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY && localBrowser.VITE_SUPABASE_PUBLISHABLE_KEY) {
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = localBrowser.VITE_SUPABASE_PUBLISHABLE_KEY;
}

const localAnonKey = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url'),
  'test-signature',
].join('.');

export default defineConfig({
  testDir: './tests/e2e',
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_APP_ENV: 'development',
      VITE_APP_URL: 'http://127.0.0.1:4173',
      VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || localAnonKey,
    },
  },
});
