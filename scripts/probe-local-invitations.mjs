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
let invitedUser, invitedClient, invitationId, barberId;
const headers = { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${login.data.session.access_token}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
try {
  const branchId = '10000000-0000-4000-8000-000000000001';
  const invoke = async (action, data = {}, requestHeaders = headers) => {
    const response = await fetch(`${config.VITE_SUPABASE_URL}/functions/v1/invite-barber`, { method: 'POST', headers: requestHeaders, body: JSON.stringify({ action, ...data }) });
    return { status: response.status, data: await response.json() };
  };
  const denied = await invoke('check', { branchId: '10000000-0000-4000-8000-000000000002', email });
  assert.equal(denied.status, 403, 'cross-tenant invitation denied');
  const checked = await invoke('check', { branchId, email });
  assert.equal(checked.status, 200); assert.equal(checked.data.kind, 'new');
  const sent = await invoke('send', { branchId, email });
  assert.equal(sent.status, 200); assert.equal(sent.data.delivered, true);
  invitationId = sent.data.id;
  const before = await manager.from('barbers').select('id').eq('email', email);
  assert.ifError(before.error); assert.equal(before.data.length, 0, 'sending does not create a barber');
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
  const action = links.map(link => new URL(link.replaceAll('&amp;', '&'))).find(link => link.origin === 'http://localhost:5173' && link.pathname === '/accept-invite');
  assert.ok(action, 'email returns to the configured application');
  assert.equal(action.searchParams.get('invitation'), invitationId);
  const invitation = { id: invitationId, token: new URLSearchParams(action.hash.slice(1)).get('token') };
  const anonymous = { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
  const resolved = await invoke('resolve', invitation, anonymous);
  assert.equal(resolved.status, 200); assert.equal(resolved.data.kind, 'new');
  const accepted = await invoke('accept', { ...invitation, name: 'Synthetic Invitation Probe', countryCode: '+965', phone: '59998591', password: 'LocalOnlyInvite123!' }, anonymous);
  assert.equal(accepted.status, 200);
  barberId = accepted.data.barber_id;
  assert.equal((await invoke('accept', { ...invitation }, anonymous)).data.error, 'INVITE_USED', 'acceptance is single-use');
  invitedClient = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await invitedClient.auth.signInWithPassword({ email, password: 'LocalOnlyInvite123!' });
  assert.ifError(signedIn.error); invitedUser = signedIn.data.user.id; assert.equal(signedIn.data.user.app_metadata.role, 'barber');
  const own = await invitedClient.from('barbers').select('id,invite_status,status,service_ids,availability_approved_at').eq('id', barberId);
  assert.ifError(own.error); assert.equal(own.data.length, 1); assert.equal(own.data[0].invite_status, 'accepted');
  assert.equal(own.data[0].status, 'inactive'); assert.deepEqual(own.data[0].service_ids, []); assert.equal(own.data[0].availability_approved_at, null);
  const secret = readFileSync('supabase/functions/.env.local', 'utf8').match(/^CRON_SHARED_SECRET=(.+)$/m)?.[1];
  assert.ok(secret);
  const cleanup = await fetch(`${config.VITE_SUPABASE_URL}/functions/v1/cleanup-notifications`, { method: 'POST', headers: { ...headers, 'x-cron-secret': secret } });
  assert.equal(cleanup.status, 200, 'local cron secret is actually configured');
  console.log('LOCAL_INVITATIONS_PASS: tenant denial, email-only invite, local email, single-use acceptance, trusted barber role, own credentials, inactive setup, scoped access and authorized cron handler');
} finally {
  if (invitedClient) await invitedClient.auth.signOut();
  // Local CI cleanup is restricted to this exact generated email and IDs.
  // Delete the private invitation first because its acceptance references the identity.
  if (invitationId) docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: `DELETE FROM private.shop_barber_invitations WHERE id='${invitationId}' AND email='${email}';` });
  if (barberId) { const removed = await manager.from('barbers').delete().eq('id', barberId).eq('email', email); assert.ifError(removed.error); }
  if (invitedUser) docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: `DELETE FROM auth.users WHERE id='${invitedUser}' AND email='${email}';` });
  await manager.auth.signOut();
}
