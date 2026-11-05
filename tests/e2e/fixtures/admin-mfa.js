import { createHmac } from 'node:crypto';
import { expect } from '@playwright/test';

// Matches the synthetic admin factor in supabase/seed.sql.
const key = Buffer.from('48656c6c6f21deadbeef', 'hex');

export async function verifyLocalAdmin(page) {
  await expect(page).toHaveURL(/\/mfa-setup$/);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const code = String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  await page.locator('input[autocomplete="one-time-code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}
