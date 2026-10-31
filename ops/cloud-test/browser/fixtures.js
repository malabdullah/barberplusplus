import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
const credentials = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));

// Some engines do not answer the first Basic challenge during automation.
// Authenticate through the same gate, then share its HttpOnly cookie with the
// browser. Never put Basic credentials in URLs or forward them to Supabase.
export const test = base.extend({
  context: async ({ context, request }, use) => {
    expect(credentials.appUrl).toBe('https://barber-test.alabdullah-cs.workers.dev');
    const response = await request.get(credentials.appUrl, { headers: { Authorization: `Basic ${Buffer.from(`tester:${credentials.accessPassword}`).toString('base64')}` } });
    expect(response.ok(), 'Test access gate accepts the existing Test credential').toBe(true);
    const { cookies } = await request.storageState();
    await context.addCookies(cookies.filter(cookie => cookie.name === 'barber_test_access' && cookie.domain === new URL(credentials.appUrl).hostname));
    await use(context);
  },
});
export { expect };
