import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const c = JSON.parse(await fs.readFile('.cloud-test/credentials.json'));
const config = JSON.parse(await fs.readFile('wrangler.cloud-test.jsonc'));
assert.equal(c.projectRef, 'qvkucvcjmojjbphlzlks');
assert.equal(c.appUrl, 'https://barber-test.alabdullah-cs.workers.dev');
const qa = JSON.parse(await fs.readFile('.cloud-test/reports-qa.json'));
const checks = [];
const client = () => createClient(config.vars.SUPABASE_URL, config.vars.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const rpc = async (sdk, action, data = {}) => {
  const r = await sdk.rpc('staff_reports', { p_action: action, p_data: data });
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const manager = client(); const barber = client();
let managerReport;
try {
  const denied = await client().rpc('staff_reports', { p_action: 'options' });
  assert(denied.error); checks.push('anonymous RPC denied');
  for (const [role, sdk] of [['manager', manager], ['barber', barber]]) {
    const login = await sdk.auth.signInWithPassword({ email: qa.users[role].email, password: qa.password });
    if (login.error) throw Error(`${role} fixture login failed: ${login.error.message}`);
    const options = await rpc(sdk, 'options');
    assert.equal(options.role, role);
    const start = performance.now();
    const response = await sdk.functions.invoke('staff-reports', { body: { preset: 'month', type: 'overview' }, headers: { Origin: c.appUrl, 'x-cloud-test-key': c.gatewaySecret } });
    if (response.error) {
      const body = await response.error.context?.json?.().catch(() => null);
      throw Error(`${role} generation failed: ${body?.error || response.error.message}`);
    }
    let report;
    for (let n = 0; n < 180; n++) {
      report = await rpc(sdk, 'get', { id: response.data.id });
      if (report.state !== 'queued') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(report.state, 'ready', report.error || 'generation not ready');
    const rows = []; let after = 0;
    while (true) {
      const page = await rpc(sdk, 'rows', { id: report.id, after, limit: 500 });
      rows.push(...page.rows.slice(0, 500));
      if (page.rows.length <= 500) break;
      after = page.rows[499].ordinal;
    }
    assert.equal(rows.length, report.total);
    const completed = rows.filter(row => row.status === 'completed');
    const fils = completed.reduce((sum, row) => sum + BigInt(row.salesFils), 0n);
    assert.equal(fils.toString(), report.result.summary.salesFils);
    assert.equal(completed.length, report.result.summary.completed);
    assert.equal(new Set(completed.map(row => row.customerId).filter(Boolean)).size, report.result.summary.customers);
    assert(rows.every(row => !('email' in row) && !('phone' in row)));
    if (role === 'manager') {
      managerReport = report;
      assert(rows.every(row => options.shops.some(shop => shop.id === row.shopId)));
      checks.push('manager only receives currently managed shops');
    } else {
      assert(report.personal);
      const own = await sdk.from('barbers').select('id').eq('user_id', login.data.user.id);
      assert(rows.every(row => own.data.some(chair => chair.id === row.barberId)));
      const forbidden = await sdk.rpc('staff_reports', { p_action: 'get', p_data: { id: managerReport.id } });
      assert(forbidden.error); checks.push('barber cannot read manager snapshot');
    }
    checks.push({ role, total: report.total, completed: completed.length, salesFils: fils.toString(), generationAndPagingMs: Math.round(performance.now() - start), snapshot: report.id });
  }
  await fs.writeFile('.cloud-test/reports-backend.json', JSON.stringify({ project: c.projectRef, checks }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await Promise.allSettled([manager.auth.signOut({ scope: 'local' }), barber.auth.signOut({ scope: 'local' })]);
}
