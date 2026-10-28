import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { localDockerProbe } from './local-docker-probe.mjs';

const config = loadEnv('development', process.cwd(), 'VITE_');
assert.equal(config.VITE_SUPABASE_URL, 'http://127.0.0.1:55321');
const docker = localDockerProbe();
const db = 'supabase_db_barber-local-test';
assert.equal(JSON.parse(docker(['inspect', db]))[0].Config.Labels['com.supabase.cli.project'], 'barber-local-test');
const manager = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = await manager.auth.signInWithPassword({ email: 'manager@barber.test', password: 'LocalOnly123!' });
assert.ifError(login.error);
const id = randomUUID();
const email = `invite-${id}@barber.test`;
let invitedUser, invitedClient;
const headers = { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${login.data.session.access_token}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
try {
  const created = await manager.from('barbers').insert({ id, branch_id: '10000000-0000-4000-8000-000000000001', name: 'Synthetic Invitation Probe', email, invite_status: 'pending' });
  assert.ifError(created.error);
  const payload = { barberId: id, email, name: 'Synthetic Invitation Probe', branchId: '10000000-0000-4000-8000-000000000001' };
  const denied = await fetch(`${config.VITE_SUPABASE_URL}/functions/v1/invite-barber`, { method: 'POST', headers, body: JSON.stringify({ ...payload, branchId: '10000000-0000-4000-8000-000000000002' }) });
  assert.equal(denied.status, 403, 'cross-tenant invitation denied');
  const response = await fetch(`${config.VITE_SUPABASE_URL}/functions/v1/invite-barber`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, 'owned invitation executes');
  const result = await response.json(); invitedUser = result.userId;
  assert.match(invitedUser, /^[a-f0-9-]{36}$/);
  let message;
  for (let i = 0; i < 30; i++) {
    const inbox = await (await fetch('http://127.0.0.1:55324/api/v1/messages')).json();
    message = inbox.messages.find(m => m.To?.some(to => to.Address === email));
    if (message) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(message, 'invitation delivered to the local mail viewer');
  const detail = await (await fetch(`http://127.0.0.1:55324/api/v1/message/${message.ID}`)).json();
  const links = String(detail.HTML || detail.Text).match(/https?:\/\/[^\s"'<>]+/g) || [];
  const action = links.map(link => new URL(link.replaceAll('&amp;', '&'))).find(link => link.origin === config.VITE_SUPABASE_URL && link.pathname === '/auth/v1/verify');
  assert.ok(action, 'email uses local Auth verification URL');
  const verification = await fetch(action, { redirect: 'manual' });
  assert.equal(verification.status, 303);
  const destination = new URL(verification.headers.get('location'));
  assert.equal(destination.origin, 'http://localhost:5173');
  assert.equal(destination.pathname, '/accept-invite');
  const tokens = new URLSearchParams(destination.hash.slice(1));
  invitedClient = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const accepted = await invitedClient.auth.setSession({ access_token: tokens.get('access_token'), refresh_token: tokens.get('refresh_token') });
  assert.ifError(accepted.error);
  assert.equal(accepted.data.user.app_metadata.role, 'barber');
  const password = await invitedClient.auth.updateUser({ password: 'LocalOnlyInvite123!' });
  assert.ifError(password.error);
  const own = await invitedClient.from('barbers').select('id').eq('id', id);
  assert.ifError(own.error); assert.equal(own.data.length, 1);
  const secret = readFileSync('supabase/functions/.env.local', 'utf8').match(/^CRON_SHARED_SECRET=(.+)$/m)?.[1];
  assert.ok(secret);
  const cleanup = await fetch(`${config.VITE_SUPABASE_URL}/functions/v1/cleanup-notifications`, { method: 'POST', headers: { ...headers, 'x-cron-secret': secret } });
  assert.equal(cleanup.status, 200, 'local cron secret is actually configured');
  console.log('LOCAL_INVITATIONS_PASS: tenant denial, owned invite, local email, correct Auth redirect, trusted barber role, password setup, scoped access and authorized cron handler');
} finally {
  if (invitedClient) await invitedClient.auth.signOut();
  const removed = await manager.from('barbers').delete().eq('id', id);
  assert.ifError(removed.error);
  // Local-only administrative cleanup is bound to the exact synthetic email.
  // No service-role key is exposed to the browser or process output.
  docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: `DELETE FROM auth.users WHERE email='${email}' AND invited_at IS NOT NULL;` });
  await manager.auth.signOut();
}
