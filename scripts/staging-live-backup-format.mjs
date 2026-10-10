import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packPrivateBackup, unpackPrivateBackup, BACKUP_LIMIT, checksum } from './staging-private-backup-format.mjs';
import { validatePrivateModel } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
const CLOUDFLARE_ACCOUNT_ID = '09c18affdb74c9a3721f79f6566df48a';

export const LIVE_FILES = Object.freeze(['live/backend.json', 'live/frontend.json',
  'live/runtime-config.js', 'live/nginx.conf', 'live/routes.json', 'live/tunnel-token', 'live/cloudflared.service']);
export const LIVE_HASHES = Object.freeze({
  bootstrap: '15016fbbc08ce25c311783227f4b039288e4b6ed1cd584d6188605a32ef5da5d',
  runtime: '9ae36ae923fb9fdc16a0b419860e2ac9a043d852ae8f50ce504b0942dbbb8308',
  nginx: '64943af25bf4b32f66055c880f162ccde5063b73cdb28a6ba4e9a7bc30b24e32',
});
export function validateLiveModels(original, backend, frontend) {
  validatePrivateModel(original);
  const expectedBackend = structuredClone(original);
  expectedBackend.services.functions.image = release.functions;
  assert.deepEqual(backend, expectedBackend, 'Unreviewed backend change');
  const labels = { 'cloud.malabdullah.barber.manual-first-release': release.commit };
  const expected = {
    name: release.frontendProject,
    services: { frontend: {
      image: release.frontend, container_name: release.frontendProject, platform: 'linux/amd64', pull_policy: 'never',
      restart: 'unless-stopped', user: '101:101', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      entrypoint: ['nginx'], command: ['-g', 'daemon off;'],
      tmpfs: ['/tmp:rw,noexec,nosuid,size=32m,uid=101,gid=101,mode=0700'],
      mem_limit: 134217728, cpus: 0.5, pids_limit: 64, ports: [], networks: { default: {} }, labels,
      volumes: [
        { type: 'bind', source: `${release.root}/runtime-config.same-origin.js`, target: '/usr/share/nginx/html/runtime-config.js', read_only: true },
        { type: 'bind', source: `${release.root}/nginx.same-origin.conf`, target: '/etc/nginx/conf.d/default.conf', read_only: true },
      ],
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
    } },
    networks: { default: { name: release.frontendProject, internal: true, labels } },
  };
  assert.deepEqual(frontend, expected, 'Unreviewed frontend change');
  return true;
}
export function validateRoutes(routes) {
  assert.deepEqual(routes, {
    tunnelId: '890d4536-b73b-47de-be24-f45a064a79f3',
    appHost: 'staging-barber.malabdullah.cloud', apiHost: 'supabase-staging.malabdullah.cloud',
    apiPath: '^/(auth|rest|storage|realtime|functions)/v1(/.*)?$',
    origins: { api: 'http://172.21.0.5:8000', frontend: 'http://172.22.0.2:8080' },
    catchAll: 'http_status:404',
    publicPaths: ['/functions/v1/whatsapp-webhook', '/functions/v1/whatsapp-flow-endpoint'],
  });
}
export const LIVE_ROUTES = Object.freeze({
  tunnelId: '890d4536-b73b-47de-be24-f45a064a79f3',
  appHost: 'staging-barber.malabdullah.cloud', apiHost: 'supabase-staging.malabdullah.cloud',
  apiPath: '^/(auth|rest|storage|realtime|functions)/v1(/.*)?$',
  origins: { api: 'http://172.21.0.5:8000', frontend: 'http://172.22.0.2:8080' }, catchAll: 'http_status:404',
  publicPaths: ['/functions/v1/whatsapp-webhook', '/functions/v1/whatsapp-flow-endpoint'],
});
export function packLiveBackup(parts, metadata) {
  const original = Object.fromEntries(Object.entries(parts).filter(([name]) => !LIVE_FILES.includes(name)));
  const legacy = JSON.parse(packPrivateBackup(original, metadata));
  const entries = { ...legacy.entries };
  for (const name of LIVE_FILES) {
    assert.ok(Buffer.isBuffer(parts[name]) && parts[name].length > 0);
    entries[name] = { sha256: checksum(parts[name]), data: parts[name].toString('base64') };
  }
  const value = Buffer.from(JSON.stringify({ kind: 'barber-staging-live-backup/v2',
    metadata: { ...metadata, release: { commit: release.commit, frontend: release.frontend, functions: release.functions },
      liveFiles: Object.fromEntries(LIVE_FILES.map(name => [name, entries[name].sha256])) }, entries }));
  unpackStagingBackup(value);
  return value;
}
export function unpackStagingBackup(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= BACKUP_LIMIT);
  const bundle = JSON.parse(bytes.toString());
  if (bundle.kind === 'barber-staging-eight-service-backup/v1') return { ...unpackPrivateBackup(bytes), version: 1 };
  assert.equal(bundle.kind, 'barber-staging-live-backup/v2');
  assert.deepEqual(Object.keys(bundle).sort(), ['entries', 'kind', 'metadata']);
  assert.deepEqual(bundle.metadata.release, { commit: release.commit, frontend: release.frontend, functions: release.functions });
  assert.deepEqual(Object.keys(bundle.metadata.liveFiles).sort(), [...LIVE_FILES].sort());
  const remaining = { ...bundle.entries }; const live = {};
  for (const name of LIVE_FILES) {
    const entry = remaining[name]; assert.ok(entry);
    assert.deepEqual(Object.keys(entry).sort(), ['data', 'sha256']);
    const data = Buffer.from(entry.data, 'base64');
    assert.ok(data.length && data.toString('base64') === entry.data);
    assert.equal(checksum(data), entry.sha256);
    assert.equal(entry.sha256, bundle.metadata.liveFiles[name]); live[name] = data; delete remaining[name];
  }
  const legacy = unpackPrivateBackup(Buffer.from(JSON.stringify({ kind: 'barber-staging-eight-service-backup/v1',
    metadata: bundle.metadata, entries: remaining })));
  assert.equal(checksum(legacy.entries['compose.private.json']), LIVE_HASHES.bootstrap);
  const backend = JSON.parse(live['live/backend.json']); const frontend = JSON.parse(live['live/frontend.json']);
  validateLiveModels(legacy.model, backend, frontend);
  assert.equal(checksum(live['live/runtime-config.js']), LIVE_HASHES.runtime);
  assert.equal(checksum(live['live/nginx.conf']), LIVE_HASHES.nginx);
  validateRoutes(JSON.parse(live['live/routes.json']));
  assert.equal(checksum(live['live/cloudflared.service']), checksum(readFileSync(new URL('../ops/staging-vps/barber-staging-cloudflared.service', import.meta.url))));
  const connector = JSON.parse(Buffer.from(live['live/tunnel-token'].toString().trim(), 'base64').toString());
  assert.equal(connector.t, LIVE_ROUTES.tunnelId); assert.equal(connector.a, CLOUDFLARE_ACCOUNT_ID);
  assert.ok(typeof connector.s === 'string' && connector.s.length >= 20);
  return { metadata: bundle.metadata, entries: { ...legacy.entries, ...live }, model: backend, frontend, version: 2 };
}
