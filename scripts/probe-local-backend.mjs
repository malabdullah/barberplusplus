import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { randomUUID } from 'node:crypto';

const config = loadEnv('development', process.cwd(), 'VITE_');
const url = config.VITE_SUPABASE_URL;
assert.equal(url, 'http://127.0.0.1:55321', 'probe is restricted to local Test');
const client = createClient(url, config.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = await client.auth.signInWithPassword({ email: 'manager@barber.test', password: 'LocalOnly123!' });
assert.ifError(login.error);
const booking = '50000000-0000-4000-8000-000000000001';
const before = await client.from('bookings').select('notes').eq('id', booking).single();
assert.ifError(before.error);
let channel, timer;
const object = `branches/10000000-0000-4000-8000-000000000001-${Date.now()}.png`;
const mimeObject = object.replace(/-[0-9]+\.png$/, `-${Date.now() + 1}.png`);
const sizeObject = object.replace(/-[0-9]+\.png$/, `-${Date.now() + 2}.png`);
const forbidden = `branches/10000000-0000-4000-8000-000000000002-${Date.now()}.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS0AAAAASUVORK5CYII=', 'base64');
try {
  const marker = 'synthetic-realtime-' + randomUUID();
  let resolveEvent;
  const event = new Promise(resolve => { resolveEvent = resolve; });
  let resolvePostgres;
  const postgresReady = new Promise(resolve => { resolvePostgres = resolve; });
  channel = client.channel('local-acceptance-' + randomUUID()).on('system', {}, value => {
    if (value.extension === 'postgres_changes' && value.status === 'ok') resolvePostgres();
  }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${booking}` }, value => {
    if (value.new.notes === marker) resolveEvent();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Realtime subscription timeout')), 15000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
      if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timeout); reject(Error('Realtime subscription failed')); }
    });
  });
  await Promise.race([postgresReady, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('PostgreSQL replication readiness timeout')), 15000); })]); clearTimeout(timer);
  const changed = await client.from('bookings').update({ notes: marker }).eq('id', booking).select('id').abortSignal(AbortSignal.timeout(15000));
  assert.ifError(changed.error); assert.equal(changed.data.length, 1);
  await Promise.race([event, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Realtime row event timeout')), 20000); })]); clearTimeout(timer);
  const uploaded = await client.storage.from('avatars').upload(object, png, { contentType: 'image/png' });
  assert.ifError(uploaded.error);
  const publicUrl = client.storage.from('avatars').getPublicUrl(object).data.publicUrl;
  const downloaded = await fetch(publicUrl); assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  const replaced = await client.storage.from('avatars').update(object, png, { contentType: 'image/png' });
  assert.ifError(replaced.error);
  const denied = await client.storage.from('avatars').upload(forbidden, png, { contentType: 'image/png' });
  assert.ok(denied.error, 'cross-tenant upload must be denied');
  const badMime = await client.storage.from('avatars').upload(mimeObject, png, { contentType: 'text/html' });
  assert.ok(badMime.error, 'active content MIME must be denied');
  assert.match(badMime.error.message, /mime|content.type/i);
  const tooLarge = await client.storage.from('avatars').upload(sizeObject, Buffer.alloc(5242881), { contentType: 'image/png' });
  assert.ok(tooLarge.error, 'oversized file must be denied');
  assert.match(tooLarge.error.message, /maximum|large|limit|size/i);
  const headers = { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${login.data.session.access_token}`, Origin: 'http://localhost:5173' };
  const fn = await fetch(`${url}/functions/v1/get-kuwait-governorates?areas=false`, { headers });
  assert.equal(fn.status, 200, 'authenticated Edge Function must execute');
  assert.equal((await fn.json()).success, true);
  const cleanup = await fetch(`${url}/functions/v1/cleanup-notifications`, { method: 'POST', headers });
  assert.equal(cleanup.status, 401, 'cron endpoint requires its separate secret');
  console.log('LOCAL_BACKEND_PASS: Auth, REST, Realtime row delivery, Storage upload/read/update, tenant denial, Edge Function and cron-secret boundary');
} finally {
  clearTimeout(timer);
  const restore = await client.from('bookings').update({ notes: before.data.notes }).eq('id', booking);
  assert.ifError(restore.error);
  const removed = await client.storage.from('avatars').remove([object, mimeObject, sizeObject]);
  assert.ifError(removed.error);
  if (channel) await client.removeChannel(channel);
  await client.auth.signOut();
}
