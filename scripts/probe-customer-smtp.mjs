// Exercises the production mail adapter against local Auth and Mailpit only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createCustomerEmailDelivery } from '../supabase/functions/customer-auth/email-delivery.ts';

execFileSync(process.execPath, ['scripts/local-test.mjs', 'status'], { stdio: 'pipe' });
const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
assert.equal(status.API_URL, 'http://127.0.0.1:55321');
const options = { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const mailer = createClient(status.API_URL, status.ANON_KEY, options);
const receiver = createClient(status.API_URL, status.ANON_KEY, options);
const deliver = createCustomerEmailDelivery(mailer.auth, 'http://localhost:5173');
const email = `smtp-probe-${randomUUID()}@example.test`;
const messages = [];
let userId;

async function openEmail(type, next) {
  let item;
  for (let attempt = 0; attempt < 20; attempt++) {
    const inbox = await (await fetch('http://127.0.0.1:55324/api/v1/messages')).json();
    item = inbox.messages.find(message => message.To.some(to => to.Address === email) && !messages.includes(message.ID));
    if (item) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(item, 'Auth SMTP delivered the customer email locally');
  messages.push(item.ID);
  const body = await (await fetch(`http://127.0.0.1:55324/api/v1/message/${item.ID}`)).json();
  const link = (body.Text || body.HTML).match(/https?:\/\/[^\s"<>]+/);
  assert.ok(link, 'Email contains a confirmation link');
  const target = new URL(link[0].replaceAll('&amp;', '&'));
  assert.equal(target.origin, status.API_URL);
  assert.equal(target.pathname, '/auth/v1/verify');
  const response = await fetch(target, { redirect: 'manual' });
  assert.ok(response.headers.get('location'), 'Auth returns to the customer callback');
  const callback = new URL(response.headers.get('location'));
  assert.equal(callback.origin, 'http://localhost:5173');
  assert.equal(callback.pathname, '/customer/email-callback');
  assert.equal(callback.searchParams.get('next'), next);
  const fragment = new URLSearchParams(callback.hash.slice(1));
  assert.equal(fragment.get('type'), type);
  assert.ok(fragment.get('access_token') && fragment.get('refresh_token'), 'Email works without a browser PKCE verifier');
  const session = await receiver.auth.setSession({ access_token: fragment.get('access_token'), refresh_token: fragment.get('refresh_token') });
  assert.ifError(session.error);
  assert.equal(session.data.user.id, userId);
  assert.equal(session.data.user.app_metadata.role, 'customer');
  assert.ok(session.data.user.email_confirmed_at);
}

try {
  const created = await admin.auth.admin.createUser({ email, password: 'SmtpProbe1!', email_confirm: false, app_metadata: { role: 'customer' }, user_metadata: { name: 'SMTP Probe Customer' } });
  assert.ifError(created.error);
  userId = created.data.user.id;
  await deliver(email, 'confirm', 'book');
  await openEmail('signup', 'book');
  await deliver(email, 'recovery', 'https://untrusted.example');
  await openEmail('recovery', 'account');
  console.log('CUSTOMER_SMTP_PASS: trusted customer registration, SMTP confirmation and recovery, customer-only callbacks and cross-browser email links. Local Auth/Mailpit only.');
} finally {
  await receiver.auth.signOut({ scope: 'local' }).catch(() => {});
  if (userId) assert.ifError((await admin.auth.admin.deleteUser(userId)).error);
  for (const id of messages) await fetch(`http://127.0.0.1:55324/api/v1/message/${id}`, { method: 'DELETE' });
}
