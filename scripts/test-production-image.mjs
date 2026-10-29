import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const name = `barber-image-check-${process.pid}`;
const image = process.env.TEST_IMAGE || 'barber-production:local-check';
const release = process.env.TEST_EXPECTED_RELEASE || 'a'.repeat(40);
function docker(...args) {
  const p = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (p.status !== 0) throw Error(`Docker image check failed: ${(p.stderr || '').slice(-1000)}`);
  return p.stdout.trim();
}
try {
  if (!process.env.TEST_IMAGE) docker('build', '--build-arg', `APP_RELEASE=${release}`, '-t', image, '.');
  const metadata = JSON.parse(docker('image', 'inspect', image))[0];
  assert.ok(metadata.Config.User && !['root', '0'].includes(metadata.Config.User.split(':')[0]));
  assert.ok(metadata.Config.Env.includes(`APP_RELEASE=${release}`), 'image itself must bind the source commit');
  docker('run', '-d', '--name', name, '-p', '127.0.0.1::8080', '-e', 'APP_ENV=production', '-e', 'APP_URL=https://app.example.test', '-e', 'SUPABASE_PUBLIC_URL=https://backend.example.test', '-e', 'SUPABASE_PUBLISHABLE_KEY=sb_publishable_image_check', image);
  const base = `http://127.0.0.1:${docker('port', name, '8080/tcp').split(':').at(-1)}`;
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try { healthy = (await fetch(`${base}/healthz`)).ok; if (healthy) break; } catch { /* Nginx startup. */ }
    await delay(1000);
  }
  assert.ok(healthy, 'image did not become healthy');
  assert.notEqual(docker('exec', name, 'id', '-u'), '0');
  const route = await fetch(`${base}/dashboard/bookings`);
  assert.ok(route.ok); assert.match(await route.text(), /<html/);
  assert.match(route.headers.get('content-security-policy'), /https:\/\/backend.example.test/);
  assert.match(route.headers.get('x-robots-tag'), /index, follow/);
  const response = await fetch(`${base}/runtime-config.js`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const context = { window: {} }; vm.runInNewContext(await response.text(), context);
  assert.equal(context.window.__BARBER_CONFIG__.release, release);
  assert.equal(context.window.__BARBER_CONFIG__.environment, 'production');
  console.log('PRODUCTION_IMAGE_PASS: non-root, health, SPA route, runtime identity, CSP and caching');
} finally { spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); }
