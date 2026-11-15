import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const state = JSON.parse(await fs.readFile('.cloud-test/credentials.json'));
const keys = JSON.parse(await fs.readFile('.cloud-test/api-keys.json'));
assert.equal(state.projectRef, 'qvkucvcjmojjbphlzlks');
const backend = `https://${state.projectRef}.supabase.co`;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(backend, keys.find(key => key.name === 'service_role').api_key, options);
const fixturePath = '.cloud-test/image-upload-fixture.json';
const check = ({ data, error }) => { assert(!error, error?.message); return data; };

if (process.argv[2] === 'cleanup') {
  const fixture = JSON.parse(await fs.readFile(fixturePath));
  assert.equal(fixture.projectRef, state.projectRef);
  assert(fixture.email.startsWith('image-upload-') && fixture.email.endsWith('@example.test'));
  const user = createClient(backend, keys.find(key => key.name === 'anon').api_key, options);
  const session = check(await user.auth.signInWithPassword({ email: fixture.email, password: fixture.password }));
  check(await admin.auth.admin.signOut(session.session.access_token, 'global'));
  check(await admin.from('barbers').delete().eq('id', fixture.barberId).eq('branch_id', fixture.shopId));
  check(await admin.from('branches').delete().eq('id', fixture.shopId).eq('manager_id', fixture.managerId));
  check(await admin.auth.admin.deleteUser(fixture.managerId));
  await fs.unlink(fixturePath);
  console.log('Removed only the isolated image-upload Test fixtures.');
} else {
  await assert.rejects(fs.access(fixturePath), 'Refuse to overwrite existing fixtures; clean them up first.');
  const fixture = {
    projectRef: state.projectRef,
    email: `image-upload-${crypto.randomBytes(6).toString('hex')}@example.test`,
    password: crypto.randomBytes(24).toString('base64url'),
    shopId: crypto.randomUUID(), barberId: crypto.randomUUID(),
  };
  const created = check(await admin.auth.admin.createUser({
    email: fixture.email, password: fixture.password, email_confirm: true,
    app_metadata: { role: 'manager' }, user_metadata: { name: 'Image upload QA' },
  }));
  fixture.managerId = created.user.id;
  await fs.writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  const areas = check(await admin.from('areas').select('id,governorate_id').order('id').limit(1));
  check(await admin.from('branches').insert({ id: fixture.shopId, manager_id: fixture.managerId,
    name: 'Image upload QA shop', name_ar: 'صالون اختبار الصور', status: 'inactive',
    governorate_id: areas[0].governorate_id, area_id: areas[0].id }));
  check(await admin.from('barbers').insert({ id: fixture.barberId, branch_id: fixture.shopId,
    name: 'Image upload QA barber', name_ar: 'حلاق اختبار الصور', status: 'inactive', management_mode: 'managed' }));
  console.log('Created an isolated synthetic manager, inactive shop and managed barber on hosted Test.');
}
