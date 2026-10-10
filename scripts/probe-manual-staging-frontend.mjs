// Opt-in native, no-network, no-port disposable probe of the exact release image.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { localDockerProbe } from './local-docker-probe.mjs';
import { prepareManualFirstRelease, manualFirstRelease as release } from './staging-manual-first-release.mjs';

let docker; let scratch; let container; let created = false; let passed = false;
let stage = 'host and source preflight';
const label = 'cloud.malabdullah.barber.disposable-frontend-probe';
const name = `barber-staging-frontend-probe-${randomBytes(8).toString('hex')}`;
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0); assert.equal(process.argv.length, 2);
  const source = readFileSync('/opt/barber-staging/supabase/compose.private.json');
  const prepared = JSON.parse(readFileSync('/opt/barber-staging/supabase/prepared.json'));
  assert.equal(createHash('sha256').update(source).digest('hex'), prepared.composeSha256);
  const templates = { runtime: readFileSync(new URL('../docker/runtime-config.js.template', import.meta.url), 'utf8'),
    nginx: readFileSync(new URL('../docker/nginx.conf.template', import.meta.url), 'utf8') };
  const config = prepareManualFirstRelease(JSON.parse(source), templates);
  docker = localDockerProbe();
  assert.equal(docker(['info', '--format', '{{.Architecture}}']), 'x86_64');
  const [metadata] = JSON.parse(docker(['image', 'inspect', release.frontend]));
  assert.equal(metadata.Architecture, 'amd64'); assert.equal(metadata.Os, 'linux');
  assert.ok(metadata.RepoDigests.includes(release.frontend));
  assert.ok(metadata.Config.Env.includes(`APP_RELEASE=${release.commit}`));
  assert.equal(docker(['ps', '-aq', '--filter', `name=^/${name}$`]), '');
  const before = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(Boolean).sort();
  scratch = mkdtempSync(join(tmpdir(), 'barber-frontend-native-'));
  for (const [file, content] of [['runtime-config.js', config.runtime], ['nginx.conf', config.nginx]]) {
    writeFileSync(join(scratch, file), content, { flag: 'wx', mode: 0o644 }); chmodSync(join(scratch, file), 0o644);
  }
  stage = 'isolated candidate startup'; created = true;
  container = docker(['run', '-d', '--name', name, '--label', `${label}=${name}`, '--network', 'none',
    '--read-only', '--user', '101:101', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '128m', '--cpus', '0.5', '--pids-limit', '64',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m,uid=101,gid=101,mode=0700',
    '--mount', `type=bind,src=${scratch}/runtime-config.js,dst=/usr/share/nginx/html/runtime-config.js,readonly`,
    '--mount', `type=bind,src=${scratch}/nginx.conf,dst=/etc/nginx/conf.d/default.conf,readonly`,
    '--entrypoint', 'nginx', release.frontend, '-g', 'daemon off;']);
  assert.match(container, /^[a-f0-9]{64}$/);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { if (docker(['exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080/healthz']) === 'ok') { ready = true; break; } } catch { /* bounded startup */ }
    await delay(250);
  }
  assert.ok(ready);
  stage = 'immutable image templates and runtime configuration';
  for (const [file, value] of [['runtime-config.js.template', templates.runtime], ['nginx.conf.template', templates.nginx]]) {
    assert.equal(docker(['exec', name, 'cat', `/opt/barber/${file}`]), value.trim());
  }
  assert.equal(docker(['exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080/runtime-config.js']), config.runtime.trim());
  const response = docker(['exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080/login']);
  assert.ok(response.includes('<div id="root">') && response.includes('/runtime-config.js'));
  stage = 'headers and sandbox';
  const headers = docker(['exec', name, 'sh', '-c', 'wget -S -O /dev/null http://127.0.0.1:8080/runtime-config.js 2>&1']);
  for (const required of ['Content-Security-Policy:', 'X-Content-Type-Options: nosniff', 'X-Robots-Tag: noindex, nofollow', 'Cache-Control: no-store', 'X-Frame-Options: DENY']) assert.ok(headers.includes(required));
  const [state] = JSON.parse(docker(['inspect', name]));
  assert.equal(state.Id, container); assert.equal(state.Config.Labels[label], name);
  assert.equal(state.Config.User, '101:101'); assert.equal(state.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), ['none']);
  assert.equal(docker(['exec', name, 'id', '-u']), '101');
  const after = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(line => line && line.split(' ')[1] !== name).sort();
  assert.deepEqual(after, before);
  passed = true;
} catch { console.error(`Manual frontend rehearsal failed at: ${stage}. No release accepted.`); process.exitCode = 1; }
finally {
  let cleaned = !created;
  if (created && docker) {
    try {
      const ids = docker(['ps', '-aq', '--filter', `name=^/${name}$`]);
      if (ids) {
        const [state] = JSON.parse(docker(['inspect', name]));
        assert.equal(state.Config.Labels[label], name);
        if (container) assert.equal(state.Id, container);
        docker(['rm', '-f', name]);
      }
      cleaned = true;
    } catch { console.error(`Disposable frontend cleanup needs attention: ${name}`); process.exitCode = 1; }
  }
  if (scratch && cleaned) rmSync(scratch, { recursive: true });
  if (passed && cleaned) console.log(JSON.stringify({ status: 'native-isolated-frontend-rehearsal-passed', commit: release.commit,
    image: release.frontend, existingServicesUnchanged: true, disposableContainerRemoved: true,
    noNetwork: true, noPublishedPorts: true, deployed: false }));
}
