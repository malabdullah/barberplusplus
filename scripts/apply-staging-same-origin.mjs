// Explicitly owner-approved runtime-only correction; exact image stays unchanged.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { localDockerProbe } from './local-docker-probe.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';

let stage = 'preflight'; let docker; let original; let changed = false; let compose;
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  assert.deepEqual(process.argv.slice(2), ['--owner-approved-same-origin']);
  const root = release.root; const sha = data => createHash('sha256').update(data).digest('hex');
  assert.equal(existsSync(`${root}/same-origin-started.json`), false);
  const receipt = JSON.parse(readFileSync(`${root}/origin-verified.json`));
  assert.equal(receipt.status, 'private-origins-verified'); assert.equal(receipt.release.commit, release.commit);
  original = JSON.parse(readFileSync(`${root}/frontend.private-origin.json`));
  assert.equal(original.services.frontend.image, release.frontend);
  const runtime = readFileSync(`${root}/runtime-config.js`, 'utf8');
  const nginx = readFileSync(`${root}/nginx.conf`, 'utf8');
  assert.equal(sha(runtime), receipt.files['runtime-config.js']); assert.equal(sha(nginx), receipt.files['nginx.conf']);
  assert.equal(runtime.split(release.apiUrl).length, 2);
  const nextRuntime = runtime.replace(release.apiUrl, release.appUrl);
  const nextNginx = nginx.replaceAll(release.apiUrl, release.appUrl)
    .replaceAll(release.apiUrl.replace('https:', 'wss:'), release.appUrl.replace('https:', 'wss:'));
  assert.equal(nextRuntime.replace(`supabaseUrl: '${release.appUrl}'`, `supabaseUrl: '${release.apiUrl}'`), runtime);
  const next = structuredClone(original);
  for (const mount of next.services.frontend.volumes) {
    if (mount.source === `${root}/runtime-config.js`) mount.source = `${root}/runtime-config.same-origin.js`;
    else if (mount.source === `${root}/nginx.conf`) mount.source = `${root}/nginx.same-origin.conf`;
    else assert.fail('Unexpected frontend mount');
  }
  docker = localDockerProbe();
  const inspect = () => JSON.parse(docker(['inspect', release.frontendProject]))[0];
  const before = inspect(); assert.equal(before.Config.Image, release.frontend);
  assert.deepEqual(Object.keys(before.HostConfig.PortBindings || {}), []);
  assert.deepEqual(Object.keys(before.NetworkSettings.Networks), [release.frontendProject]);
  assert.equal(JSON.parse(docker(['network', 'inspect', release.frontendProject]))[0].Internal, true);
  const privateIp = before.NetworkSettings.Networks[release.frontendProject].IPAddress;
  assert.equal(`http://${privateIp}:8080`, receipt.origins.frontend);
  const inventory = () => docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n')
    .filter(line => line && line.split(' ')[1] !== release.frontendProject).sort();
  const nonTarget = inventory();
  const record = { commit: release.commit, image: release.frontend, approvedProcedure: 'owner-approved-same-origin-login-fix',
    at: new Date().toISOString(), oldRuntimeSha256: sha(runtime), newRuntimeSha256: sha(nextRuntime),
    oldNginxSha256: sha(nginx), newNginxSha256: sha(nextNginx), backendChanged: false, automationEnabled: false };
  for (const [name, content, mode] of [['runtime-config.same-origin.js', nextRuntime, 0o644], ['nginx.same-origin.conf', nextNginx, 0o644],
    ['frontend.same-origin.json', JSON.stringify(next), 0o600], ['same-origin-started.json', JSON.stringify(record, null, 2), 0o600]]) {
    writeFileSync(`${root}/${name}`, content, { flag: 'wx', mode });
  }
  compose = model => docker(['compose', '--project-directory', root, '-p', model.name, '-f', '-', 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90'],
    { input: JSON.stringify(model), timeout: 120000 });
  stage = 'frontend configuration switch'; changed = true; compose(next);
  stage = 'health and identity verification';
  const after = inspect(); assert.equal(after.Config.Image, release.frontend);
  assert.equal(after.NetworkSettings.Networks[release.frontendProject].IPAddress, privateIp);
  assert.deepEqual(Object.keys(after.HostConfig.PortBindings || {}), []);
  assert.equal(after.State.Health.Status, 'healthy');
  const response = await fetch(`${receipt.origins.frontend}/runtime-config.js`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200); assert.equal(await response.text(), nextRuntime);
  assert.ok(response.headers.get('content-security-policy').includes(release.appUrl.replace('https:', 'wss:')));
  assert.deepEqual(inventory(), nonTarget);
  writeFileSync(`${root}/same-origin-verified.json`, JSON.stringify({ ...record, verifiedAt: new Date().toISOString(),
    origin: receipt.origins.frontend, nonTargetContainersUnchanged: true, normalBrowserAcceptance: false }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'same-origin-runtime-verified', commit: release.commit, nonTargetContainersUnchanged: true }));
} catch (error) {
  console.error(`Same-origin change failed at ${stage}.`);
  const line = String(error?.stack || '').match(/apply-staging-same-origin\.mjs:(\d+):(\d+)/);
  if (line) console.error(`Check location: ${line[1]}:${line[2]}`);
  if (changed) { try { compose(original); console.error('Original frontend configuration restored.'); } catch { console.error('Frontend rollback requires operator attention.'); } }
  process.exitCode = 1;
}
