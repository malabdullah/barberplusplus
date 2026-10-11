// Read-only public-ingress acceptance for the exact manual staging candidate.
// Synthetic logins only; no trace, video, tokens, response bodies or passwords in output.
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';

let stage = 'credentials'; let browser;
const results = [];
try {
  const file = '/Users/malabdullah/Documents/Barber++ Staging Secrets/cloudflare-access-service-token.env';
  assert.equal(statSync(file).mode & 0o077, 0);
  const env = parseEnv(readFileSync(file, 'utf8'));
  assert.ok(env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET);
  const access = { 'CF-Access-Client-Id': env.ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.ACCESS_CLIENT_SECRET };
  const allowed = new Set([release.appUrl, release.apiUrl]);
  const request = async (url, options = {}, authenticated = false) => {
    assert.ok(allowed.has(new URL(url).origin));
    return fetch(url, { ...options, headers: { ...(authenticated ? access : {}), ...options.headers },
      redirect: 'manual', signal: AbortSignal.timeout(20000) });
  };
  const pass = name => { results.push(name); console.log(JSON.stringify({ check: name, passed: true })); };
  stage = 'Access default deny';
  const protectedPaths = ['/rest/v1/', '/auth/v1/health', '/storage/v1/', '/realtime/v1/websocket', '/functions/v1/send-whatsapp-message'];
  for (const endpoint of ['whatsapp-webhook', 'whatsapp-flow-endpoint']) {
    for (const suffix of ['/', '/child', '/child/deeper', '-other', '%2fchild']) protectedPaths.push(`/functions/v1/${endpoint}${suffix}`);
  }
  for (const url of [`${release.appUrl}/runtime-config.js`, ...protectedPaths.map(path => release.apiUrl + path),
    ...['/auth/v1/health', '/rest/v1/', '/storage/v1/', '/realtime/v1/websocket', '/functions/v1/whatsapp-webhook', '/functions/v1/whatsapp-flow-endpoint'].map(path => release.appUrl + path)]) {
    const r = await request(url);
    console.log(JSON.stringify({ path: new URL(url).pathname, status: r.status, accessRedirect: (r.headers.get('location') || '').includes('.cloudflareaccess.com') }));
    assert.ok([302, 303, 307, 308].includes(r.status));
    assert.ok(new URL(r.headers.get('location')).hostname.endsWith('.cloudflareaccess.com'));
    await r.arrayBuffer();
  }
  pass(stage);
  stage = 'runtime and security headers';
  const runtime = await request(`${release.appUrl}/runtime-config.js`, {}, true);
  assert.equal(runtime.status, 200); const runtimeText = await runtime.text();
  assert.ok(runtimeText.includes(release.commit) && runtimeText.includes("environment: 'staging'"));
  assert.ok(runtimeText.includes(`supabaseUrl: '${release.appUrl}'`));
  const anon = runtimeText.match(/supabasePublishableKey:\s*'([^']+)'/)?.[1]; assert.ok(anon);
  assert.equal(JSON.parse(Buffer.from(anon.split('.')[1], 'base64url')).role, 'anon');
  for (const path of ['/', '/login', '/runtime-config.js']) {
    const r = await request(release.appUrl + path, {}, true);
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    assert.ok(r.headers.get('referrer-policy'));
    assert.ok(r.headers.get('cache-control')?.includes(path === '/runtime-config.js' ? 'no-store' : 'no-cache'));
    await r.arrayBuffer();
  }
  const health = await request(`${release.apiUrl}/auth/v1/health`, { headers: { apikey: anon } }, true);
  assert.equal(health.status, 200); await health.arrayBuffer(); pass(stage);
  stage = 'exact public Meta endpoints reject invalid requests';
  for (const endpoint of ['whatsapp-webhook', 'whatsapp-flow-endpoint']) {
    const r = await request(`${release.apiUrl}/functions/v1/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401); assert.ok(!(r.headers.get('location') || '').includes('cloudflareaccess')); await r.arrayBuffer();
  }
  const challenge = await request(`${release.apiUrl}/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=test`);
  assert.equal(challenge.status, 403); await challenge.arrayBuffer(); pass(stage);
  stage = 'read synthetic test credentials';
  const accounts = JSON.parse(execFileSync('ssh', ['-i', '/Users/malabdullah/.ssh/barber_staging_admin_ed25519',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'barber-admin@185.97.146.8',
    'sudo -n /opt/barber-staging-observer/node -e \'process.stdout.write(require("node:fs").readFileSync("/opt/barber-staging/supabase/synthetic-accounts.json"))\''],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }));
  assert.ok(accounts.every(account => account.email.endsWith('@barber.test')));
  browser = await chromium.launch();
  for (const [role, home, denied] of [['admin', '/admin', '/dashboard'], ['manager', '/dashboard', '/admin'],
    ['agent', '/agent', '/admin'], ['barber', '/barber', '/dashboard']]) {
    stage = `browser ${role} login and authorization`;
    const account = accounts.find(account => account.email === `${role}@barber.test`); assert.ok(account);
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    // Never send Cloudflare service credentials to third-party assets or redirects.
    await context.route('**/*', async route => {
      const r = route.request();
      await route.continue({ headers: allowed.has(new URL(r.url()).origin) ? { ...r.headers(), ...access } : r.headers() });
    });
    const page = await context.newPage();
    await page.goto(`${release.appUrl}/login`);
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === home || url.pathname.startsWith(home + '/'), { timeout: 20000 });
    if (role === 'manager') {
      await page.goto(`${release.appUrl}/dashboard/branches`);
      await page.locator('.branch-card-name', { hasText: 'Synthetic Branch' }).waitFor({ state: 'visible' });
      assert.equal(await page.locator('.branch-card-name', { hasText: 'Other Tenant Branch' }).count(), 0);
    }
    await page.goto(release.appUrl + denied);
    await page.waitForURL(url => url.pathname === home || url.pathname.startsWith(home + '/'), { timeout: 20000 });
    await context.close(); pass(stage);
  }
  await browser.close(); browser = null;
  stage = 'public tenant isolation';
  const account = accounts.find(account => account.email === 'barber@barber.test');
  const login = await request(`${release.apiUrl}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) }, true);
  assert.equal(login.status, 200); const session = await login.json();
  const headers = { apikey: anon, Authorization: `Bearer ${session.access_token}` };
  for (const [id, count] of [['10000000-0000-4000-8000-000000000001', 1], ['10000000-0000-4000-8000-000000000002', 0]]) {
    const r = await request(`${release.apiUrl}/rest/v1/branches?select=id&id=eq.${id}`, { headers }, true);
    assert.equal(r.status, 200); assert.equal((await r.json()).length, count);
  }
  pass(stage);
  console.log(JSON.stringify({ status: 'public-smoke-and-role-checks-passed', commit: release.commit, checks: results }));
  if (process.env.STAGING_ACCEPTANCE_REPORT) writeFileSync(process.env.STAGING_ACCEPTANCE_REPORT,
    JSON.stringify({ status: 'public-smoke-and-role-checks-passed', commit: release.commit, checks: results, testedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', stage, completed: results }));
  const line = String(error?.stack || '').match(/accept-manual-staging-live\.mjs:(\d+):(\d+)/);
  if (line) console.error(`Check location: ${line[1]}:${line[2]}`);
  process.exitCode = 1;
} finally { if (browser) await browser.close(); }
