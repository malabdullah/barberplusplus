// Synthetic LOCAL rehearsal only; not a VPS capture/export or deployment gate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const LIMIT = 32 * 1024 * 1024;
// Same immutable builder as the frontend; provides GNU tar with xattr support.
const TAR_IMAGE = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';

// This Storage version's 4xx serializer omits `code` and wraps denials in HTTP
// 400. Require the documented denial status/error pair, never any error >=400.
export function isPrivateStorageDenied(status, body) {
  return ((status === 400 || status === 404) && body?.statusCode === '404'
    && ['Bucket not found', 'not_found'].includes(body.error))
    || ((status === 400 || status === 403) && body?.statusCode === '403' && body.error === 'Unauthorized');
}

export function packRecoveryFixture(database, storage, databaseConfig, config) {
  assert.ok([database, storage, databaseConfig].every(Buffer.isBuffer));
  assert.ok(database.length > 0 && storage.length > 0 && databaseConfig.length > 0);
  const value = Buffer.from(JSON.stringify({ version: 1, kind: 'local-synthetic-core',
    database: database.toString('base64'), storage: storage.toString('base64'),
    databaseConfig: databaseConfig.toString('base64'), databaseConfigSha256: digest(databaseConfig),
    databaseSha256: digest(database), storageSha256: digest(storage), config }));
  assert.ok(value.length <= LIMIT, 'Synthetic recovery fixture too large');
  return value;
}

export function unpackRecoveryFixture(value) {
  assert.ok(Buffer.isBuffer(value) && value.length <= LIMIT);
  const data = JSON.parse(value.toString('utf8'));
  assert.equal(data.version, 1);
  assert.equal(data.kind, 'local-synthetic-core');
  const database = Buffer.from(data.database, 'base64');
  const storage = Buffer.from(data.storage, 'base64');
  const databaseConfig = Buffer.from(data.databaseConfig, 'base64');
  assert.ok(database.length && storage.length && databaseConfig.length);
  assert.equal(digest(database), data.databaseSha256);
  assert.equal(digest(storage), data.storageSha256);
  assert.equal(digest(databaseConfig), data.databaseConfigSha256);
  return { database, storage, databaseConfig, config: data.config };
}

export async function rehearseCoreRecovery({ model, upstream, docker, compose, accounts, key, anon }) {
  const source = model.name;
  assert.match(source, /^barber-core-probe-[a-f0-9]{16}$/);
  const project = `${source}-restore`;
  const label = 'barber.staging.core-probe';
  assert.equal(model.networks.default.internal, true);
  const context = docker(['context', 'show']).trim();
  assert.ok(JSON.parse(docker(['context', 'inspect', context]))[0].Endpoints.docker.Host.startsWith('unix://'));
  for (const service of Object.values(model.services)) {
    assert.equal(service.labels[label], source);
    assert.deepEqual(service.ports, []);
    assert.deepEqual(Object.keys(service.networks), ['default']);
    const [live] = JSON.parse(docker(['inspect', service.container_name]));
    assert.equal(live.Config.Labels[label], source);
    assert.deepEqual(Object.keys(live.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(live.NetworkSettings.Networks), [source]);
  }
  const restored = structuredClone(model);
  restored.name = project;
  restored.networks.default.name = project;
  restored.networks.default.labels[label] = project;
  for (const volume of Object.values(restored.volumes)) {
    assert.equal(volume.labels[label], source);
    assert.ok(volume.name.startsWith(`${source}-`));
    volume.name = volume.name.replace(source, project);
    volume.labels[label] = project;
  }
  for (const [name, service] of Object.entries(restored.services)) {
    service.container_name = `${project}-${name}`;
    service.labels[label] = project;
    service.pull_policy = 'never';
  }
  const runRestore = (args, options = {}) => docker(['compose', '--project-directory', upstream,
    '-p', project, '-f', '-', ...args], { input: JSON.stringify(restored), ...options });
  const archiveStorage = (targetModel, restore, input) => {
    const volume = targetModel.volumes.storage.name;
    const helper = `${targetModel.name}-storage-archive`;
    assert.equal(JSON.parse(docker(['volume', 'inspect', volume]))[0].Labels[label], targetModel.name);
    assert.equal(JSON.parse(docker(['inspect', targetModel.services.storage.container_name]))[0].State.Running, false);
    assert.equal(docker(['ps', '-aq', '--filter', `name=^/${helper}$`]).trim(), '');
    try {
      return docker(['run', '--rm', '-i', '--name', helper, '--network', 'none', '--read-only',
      '--platform', targetModel.services.db.platform, '--label', `${label}=${targetModel.name}`,
      '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE',
      '--security-opt', 'no-new-privileges', '--mount', `type=volume,src=${volume},dst=/data${restore ? '' : ',readonly'}`,
      '--entrypoint', 'tar', TAR_IMAGE, '--xattrs', '--xattrs-include=user.*',
      '--acls', '--numeric-owner', '-C', '/data', restore ? '-xpf' : '-cpf', '-', ...(restore ? [] : ['.'])],
      { input, encoding: null, maxBuffer: LIMIT, timeout: 60000 });
    } finally {
      // Also catch a helper left running if the Docker CLI timed out.
      const remaining = docker(['ps', '-aq', '--filter', `name=^/${helper}$`]).trim();
      if (remaining) {
        assert.equal(JSON.parse(docker(['inspect', remaining]))[0].Config.Labels[label], targetModel.name);
        docker(['rm', '-f', remaining]);
      }
    }
  };
  const query = (name, sql) => docker(['exec', '-i', '-u', 'postgres', `${name}-db`,
    'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input: sql }).trim();
  let started = false;
  const scratch = mkdtempSync(join(tmpdir(), 'barber-core-recovery-'));
  let stage = 'capture';
  try {
    docker(['pull', '--platform', model.services.db.platform, TAR_IMAGE], { timeout: 300000 });
    // Add only a fresh synthetic Vault value; preserve it through the restore.
    const secret = randomBytes(24).toString('hex');
    assert.equal(query(source, 'SHOW cron.launch_active_jobs;'), 'off');
    query(source, `SELECT vault.create_secret('${secret}', 'synthetic_recovery_probe');`);
    compose(['stop', 'auth', 'rest', 'storage', 'imgproxy', 'mailpit'], { timeout: 60000 });
    const database = docker(['exec', '-u', 'postgres', `${source}-db`,
      'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom'],
    { encoding: null, maxBuffer: LIMIT });
    // docker cp omits file-backend xattrs; retain content-type/cache-control/etag.
    const storage = archiveStorage(model, false);
    compose(['stop', 'db'], { timeout: 60000 });
    // Vault ciphertext needs the separate db-config root-key volume too.
    // Capture in memory only; never print the archive or key.
    const databaseConfig = docker(['cp', `${source}-db:/etc/postgresql-custom/.`, '-'],
      { encoding: null, maxBuffer: LIMIT });
    stage = 'encrypted round-trip';
    const run = (command, args, options = {}) => execFileSync(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, maxBuffer: LIMIT, ...options,
    });
    const identity = join(scratch, 'disposable-identity.txt');
    run('age-keygen', ['-o', identity]);
    const recipient = run('age-keygen', ['-y', identity], { encoding: 'utf8' }).trim();
    const packed = packRecoveryFixture(database, storage, databaseConfig, model);
    const ciphertext = run('age', ['-r', recipient], { input: packed });
    const unpacked = unpackRecoveryFixture(run('age', ['--decrypt', '-i', identity], { input: ciphertext }));
    assert.deepEqual(unpacked.config, model);
    assert.equal(digest(unpacked.database), digest(database));
    assert.equal(digest(unpacked.storage), digest(storage));
    assert.equal(digest(unpacked.databaseConfig), digest(databaseConfig));
    const damaged = Buffer.from(ciphertext);
    damaged[damaged.length - 1] ^= 1;
    assert.throws(() => run('age', ['--decrypt', '-i', identity], { input: damaged }));
    console.log('PASS: synthetic DB/Storage/config encrypted round-trip and tamper rejection');
    stage = 'fresh recovery database';
    started = true;
    runRestore(['create', '--no-build', '--pull', 'never', 'db'], { timeout: 60000 });
    const [created] = JSON.parse(docker(['inspect', `${project}-db`]));
    assert.equal(created.Config.Labels[label], project);
    assert.equal(created.State.Running, false);
    assert.ok(created.Mounts.filter((mount) => mount.Type === 'volume').every((mount) => mount.Name.startsWith(`${project}-`)));
    docker(['cp', '--archive', '-', `${project}-db:/etc/postgresql-custom`],
      { input: unpacked.databaseConfig, maxBuffer: LIMIT });
    runRestore(['up', '-d', '--wait', '--wait-timeout', '180', 'db'], { timeout: 240000 });
    const [target] = JSON.parse(docker(['inspect', `${project}-db`]));
    assert.equal(target.Config.Labels[label], project);
    assert.ok(target.Mounts.filter((mount) => mount.Type === 'volume').every((mount) => mount.Name.startsWith(`${project}-`)));
    assert.equal(query(project, 'SHOW cron.launch_active_jobs;'), 'off');
    stage = 'logical database import';
    // Background extension workers can keep the empty default database open.
    // Drop ONLY this newly initialized recovery target, never the source DB.
    docker(['exec', '-i', '-u', 'postgres', `${project}-db`, 'psql',
      '-U', 'supabase_admin', '-d', 'template1', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: 'DROP DATABASE postgres WITH (FORCE);' });
    docker(['exec', '-i', '-u', 'postgres', `${project}-db`, 'pg_restore',
      '-U', 'supabase_admin', '-d', 'template1', '--create', '--exit-on-error'],
    { input: unpacked.database, timeout: 60000 });
    stage = 'recovered database verification';
    assert.equal(query(project, 'SELECT count(*) FROM auth.users;'), '6');
    assert.equal(query(project, 'SELECT count(*) FROM public.branches;'), '2');
    stage = 'recovered Vault decryption';
    assert.equal(query(project, "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'synthetic_recovery_probe';"), secret);
    stage = 'Storage file restore';
    runRestore(['create', '--no-build', '--pull', 'never'], { timeout: 60000 });
    archiveStorage(restored, true, unpacked.storage);
    stage = 'recovered service startup';
    runRestore(['up', '-d', '--wait', '--wait-timeout', '180'], { timeout: 240000 });
    for (const service of Object.values(restored.services)) {
      const [live] = JSON.parse(docker(['inspect', service.container_name]));
      assert.equal(live.Config.Labels[label], project);
      assert.deepEqual(Object.keys(live.HostConfig.PortBindings || {}), []);
      assert.deepEqual(Object.keys(live.NetworkSettings.Networks), [project]);
    }
    assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Internal, true);
    stage = 'recovered Auth, RLS and Storage';
    const probe = `const input=JSON.parse(await new Promise(r=>{let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>r(s));}));
      const ok=(x,step)=>{if(!x)throw new Error('RECOVERY_CHECK_'+step)};
      const login=await fetch('http://auth:9999/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input.barber)});
      ok(login.status===200,'LOGIN');const user=await login.json();ok(user.user.app_metadata.role==='barber','ROLE');
      const headers={Authorization:'Bearer '+user.access_token};
      const own=await fetch('http://rest:3000/branches?select=id&id=eq.10000000-0000-4000-8000-000000000001',{headers});
      const other=await fetch('http://rest:3000/branches?select=id&id=eq.10000000-0000-4000-8000-000000000002',{headers});
      ok(own.status===200&&(await own.json()).length===1,'OWN_BRANCH');ok(other.status===200&&(await other.json()).length===0,'OTHER_BRANCH');
      const object=await fetch('http://storage:5000/object/authenticated/synthetic-probe/check.txt',{headers:{Authorization:'Bearer '+input.key}});
      const content=await object.text();
      if(object.status!==200) console.error('RECOVERY_STORAGE_STATUS_'+object.status);
      for(const code of ['ENOENT','EACCES','ENODATA','NotFound','InvalidJWT','NoSuchKey']) if(content.includes(code)) console.error('RECOVERY_STORAGE_REASON_'+code);
      ok(object.status===200&&content==='synthetic-only'&&(object.headers.get('content-type')||'').startsWith('text/plain'),'STORAGE');
      const denied=await fetch('http://storage:5000/object/authenticated/synthetic-probe/check.txt',{headers:{Authorization:'Bearer '+input.anon}});
      const denial=await denied.json();ok((${isPrivateStorageDenied.toString()})(denied.status,denial),'ANON_DENIAL');
      console.log('PASS: recovered synthetic Auth login, cross-tenant RLS denial, private Storage content and anonymous denial');`;
    console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module', '-e', probe], {
      input: JSON.stringify({ barber: accounts.find((account) => account.email === 'barber@barber.test'), key, anon }),
    }).trim());
    console.log('PASS: local synthetic logical DB/Auth/Vault + Storage/config recovery into new isolated volumes; not a live VPS backup receipt');
  } catch (error) {
    if (stage === 'recovered Auth, RLS and Storage') {
      const check = String(error.stderr || '').match(/Error: RECOVERY_CHECK_(LOGIN|ROLE|OWN_BRANCH|OTHER_BRANCH|STORAGE|ANON_DENIAL)\b/);
      if (check) console.error(`Synthetic recovery assertion failed: ${check[1]}`);
      for (const token of String(error.stderr || '').matchAll(/^RECOVERY_STORAGE_(?:STATUS_[1-5][0-9]{2}|REASON_(?:ENOENT|EACCES|ENODATA|NotFound|InvalidJWT|NoSuchKey))$/gm)) console.error(token[0]);
    }
    // Only sanitized error headers, never pg_restore SQL/DETAIL or service logs.
    if (stage === 'logical database import') {
      const headers = String(error.stderr || '').split('\n')
        .filter((line) => /^pg_restore: error:|^ERROR:/.test(line)).slice(0, 3)
        .map((line) => line.replace(/"[^"]*"|'[^']*'/g, '[identifier/value]')
          .replace(/[A-Za-z0-9_+/=.-]{40,}/g, '[redacted]'));
      console.error(headers.join('\n'));
    }
    throw new Error(`Local synthetic recovery rehearsal failed at ${stage}`);
  } finally {
    try {
      if (started) {
        for (const service of Object.values(restored.services)) {
          const ids = docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]).trim();
          if (ids) assert.equal(JSON.parse(docker(['inspect', ids]))[0].Config.Labels[label], project);
        }
        for (const volume of Object.values(restored.volumes)) {
          const names = docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]).trim();
          if (names) assert.equal(JSON.parse(docker(['volume', 'inspect', names]))[0].Labels[label], project);
        }
        const network = docker(['network', 'ls', '-q', '--filter', `name=^${project}$`]).trim();
        if (network) assert.equal(JSON.parse(docker(['network', 'inspect', network]))[0].Labels[label], project);
        runRestore(['down', '--volumes', '--timeout', '10'], { timeout: 60000 });
        console.log('Removed only the labeled recovery-probe services, network and synthetic volumes.');
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
