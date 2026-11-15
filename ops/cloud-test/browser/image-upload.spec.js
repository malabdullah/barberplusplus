import { test, expect } from './fixtures.js';
import fs from 'node:fs';

const state = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));
const fixture = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/image-upload-fixture.json', import.meta.url)));
const config = JSON.parse(fs.readFileSync(new URL('../../../wrangler.cloud-test.jsonc', import.meta.url)));
const backend = `https://${state.projectRef}.supabase.co`;
const source = fs.readFileSync(new URL('../../../public/booking-demo/city-centre.png', import.meta.url));

for (const [table, id, field] of [
  ['branches', fixture.shopId, 'image_url'],
  ['barbers', fixture.barberId, 'avatar_url'],
]) {
  test(`${table}: optimizes a real upload and preserves transparent images`, async ({ page, request, browserName }) => {
    expect(state.projectRef).toBe('qvkucvcjmojjbphlzlks');
    expect(fixture.projectRef).toBe(state.projectRef);
    const apikey = config.vars.SUPABASE_PUBLISHABLE_KEY;
    const login = await request.post(`${backend}/auth/v1/token?grant_type=password`, {
      headers: { apikey }, data: { email: fixture.email, password: fixture.password },
    });
    expect(login.ok()).toBe(true);
    const { access_token: token } = await login.json();
    const headers = { apikey, Authorization: `Bearer ${token}` };
    const rowUrl = `${backend}/rest/v1/${table}?id=eq.${id}`;
    const read = async () => {
      const response = await request.get(`${rowUrl}&select=id,${field}`, { headers });
      expect(response.ok()).toBe(true);
      return (await response.json())[0];
    };
    const original = await read();
    // Never let the app remove an existing uploaded fixture image.
    expect(original[field]).toBe(null);
    const uploaded = new Set();
    const recordUpload = response => {
      const path = new URL(response.url()).pathname;
      if (response.request().method() === 'POST' && path.startsWith(`/storage/v1/object/avatars/${table}/${id}-`) && response.ok()) {
        uploaded.add(path.replace('/storage/v1/object/', '/storage/v1/object/public/'));
      }
    };
    page.on('response', recordUpload);
    try {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(fixture.email);
      await page.locator('input[type="password"]').fill(fixture.password);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/);

      const editPath = `/dashboard/${table}/${id}/edit`;
      await page.goto(editPath);
      await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-shop.png', mimeType: 'image/png', buffer: source });
      await page.locator('form:has(input[type="file"]) button[type="submit"]').click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${table}$`));
      const saved = await read();
      expect(saved[field]).toMatch(/\.(webp|jpg)$/);
      const imageResponse = await request.get(saved[field]);
      expect(imageResponse.ok()).toBe(true);
      const bytes = await imageResponse.body();
      expect(bytes.length).toBeLessThan(source.length / 2);
      expect(imageResponse.headers()['content-type']).toMatch(/^image\/(webp|jpeg)/);
      const dimensions = await page.evaluate(async url => {
        const image = new Image(); image.src = url; await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, saved[field]);
      expect(dimensions).toEqual([1254, 1254]);

      await page.goto(editPath);
      const transparent = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ab821f'; ctx.fillRect(40, 40, 220, 220);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await page.locator('input[type="file"]').setInputFiles({ name: 'transparent-logo.png', mimeType: 'image/png', buffer: Buffer.from(transparent, 'base64') });
      await page.locator('form:has(input[type="file"]) button[type="submit"]').click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${table}$`));
      const withAlpha = await read();
      expect(withAlpha[field]).toMatch(/\.(webp|png)$/);
      const alpha = await page.evaluate(async url => {
        const blob = await (await fetch(url)).blob();
        const image = new Image(); const src = URL.createObjectURL(blob);
        try {
          image.src = src; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, 1, 1).data[3];
        } finally { URL.revokeObjectURL(src); }
      }, withAlpha[field]);
      expect(alpha).toBe(0);
      fs.writeFileSync(`.cloud-test/image-upload-${browserName}-${table}.json`, JSON.stringify({ browserName, table, originalBytes: source.length, optimizedBytes: bytes.length, dimensions, alphaPreserved: true }, null, 2));
    } finally {
      page.off('response', recordUpload);
      const current = await read();
      if (current[field] !== original[field]) {
        expect(current[field]).toContain(`${backend}/storage/v1/object/public/avatars/${table}/${id}-`);
        const restore = await request.patch(`${rowUrl}&${field}=eq.${encodeURIComponent(current[field])}`, {
          headers: { ...headers, Prefer: 'return=representation' }, data: { [field]: original[field] },
        });
        expect(restore.ok()).toBe(true);
        expect((await restore.json())[0][field]).toBe(original[field]);
      }
      for (const path of uploaded) {
        const prefix = path.split('/avatars/')[1];
        const cleanup = await request.delete(`${backend}/storage/v1/object/avatars`, { headers, data: { prefixes: [prefix] } });
        expect(cleanup.ok()).toBe(true);
      }
    }
  });
}
