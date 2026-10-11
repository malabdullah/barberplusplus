// Exact candidate preparation only. No Docker, network, secret output or deployment.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validatePrivateModel, PROJECT } from './staging-private-model.mjs';

export const manualFirstRelease = Object.freeze({
  commit: '6217cb33bd9aaf32aa0fa924278f314988449f12',
  ciRunId: '37747708348', releaseRunId: '37748167638',
  frontend: 'ghcr.io/malabdullah/barberplusplus@sha256:4d656e8cf03535b14c7a1cd5d55c604e0bb172147777102d854ae6f329659aab',
  functions: 'ghcr.io/malabdullah/barberplusplus-functions@sha256:b748a2d51c78df994ff93e0e26066d8193d61032ee2c21cad75264c1f2bb4c35',
  appUrl: 'https://staging-barber.malabdullah.cloud',
  apiUrl: 'https://supabase-staging.malabdullah.cloud',
  root: '/opt/barber-staging/manual-first-release',
  frontendProject: 'barber-staging-frontend',
});

export function prepareManualFirstRelease(original, templates, now = Date.now()) {
  validatePrivateModel(original);
  assert.deepEqual(Object.keys(templates).sort(), ['nginx', 'runtime']);
  const env = original.services.functions.environment;
  assert.equal(env.APP_ENV, 'staging'); assert.equal(env.APP_URL, manualFirstRelease.appUrl);
  assert.equal(env.SUPABASE_URL, 'http://api-gw:8000');
  assert.equal(original.services.auth.environment.API_EXTERNAL_URL, `${manualFirstRelease.apiUrl}/auth/v1`);
  assert.equal(original.services.auth.environment.GOTRUE_SITE_URL, manualFirstRelease.appUrl);
  const anon = env.SUPABASE_ANON_KEY;
  assert.equal(typeof anon, 'string');
  assert.match(anon, /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
  const [header, payload, signature] = anon.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'HS256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.role, 'anon'); assert.equal(claims.iss, 'supabase');
  assert.ok(Number.isSafeInteger(claims.exp) && claims.exp * 1000 > now + 86400000);
  assert.equal(signature, createHmac('sha256', env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url'));
  assert.notEqual(anon, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(original.services['api-gw'].environment.ANON_KEY, anon);
  const backend = structuredClone(original);
  backend.services.functions.image = manualFirstRelease.functions;
  backend.services['api-gw'].ports = [{ target: 8000, published: '54331', host_ip: '127.0.0.1', protocol: 'tcp' }];
  const project = manualFirstRelease.frontendProject;
  const labels = { 'cloud.malabdullah.barber.manual-first-release': manualFirstRelease.commit };
  const frontend = {
    name: project,
    services: { frontend: {
      image: manualFirstRelease.frontend, container_name: project, platform: 'linux/amd64', pull_policy: 'never',
      restart: 'unless-stopped', user: '101:101', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      entrypoint: ['nginx'], command: ['-g', 'daemon off;'],
      tmpfs: ['/tmp:rw,noexec,nosuid,size=32m,uid=101,gid=101,mode=0700'],
      mem_limit: 134217728, cpus: 0.5, pids_limit: 64,
      ports: [{ target: 8080, published: '18080', host_ip: '127.0.0.1', protocol: 'tcp' }],
      networks: { default: {} }, labels,
      volumes: [
        { type: 'bind', source: `${manualFirstRelease.root}/runtime-config.js`, target: '/usr/share/nginx/html/runtime-config.js', read_only: true },
        { type: 'bind', source: `${manualFirstRelease.root}/nginx.conf`, target: '/etc/nginx/conf.d/default.conf', read_only: true },
      ],
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
    } },
    networks: { default: { name: project, internal: true, labels } },
  };
  const variables = {
    APP_ENV: 'staging', APP_URL: manualFirstRelease.appUrl, SUPABASE_PUBLIC_URL: manualFirstRelease.apiUrl,
    SUPABASE_PUBLISHABLE_KEY: anon, APP_RELEASE: manualFirstRelease.commit,
    SUPABASE_REALTIME_URL: manualFirstRelease.apiUrl.replace('https:', 'wss:'), ROBOTS_HEADER: 'noindex, nofollow',
  };
  const render = text => {
    assert.equal(typeof text, 'string'); assert.ok(text.length < 16384);
    return text.replace(/\$\{([A-Z_]+)\}/g, (_, key) => { assert.ok(Object.hasOwn(variables, key)); return variables[key]; });
  };
  const runtime = render(templates.runtime); const nginx = render(templates.nginx);
  assert.ok(runtime.includes(manualFirstRelease.commit) && runtime.includes(anon));
  assert.ok(nginx.includes('noindex, nofollow') && nginx.includes('Content-Security-Policy'));
  // Reconstructing the bootstrap must be byte-equivalent: only the exact
  // Functions image and gateway loopback mapping may differ. No migrations.
  const restored = structuredClone(backend);
  restored.services.functions.image = original.services.functions.image;
  restored.services['api-gw'].ports = [];
  assert.deepEqual(restored, original); assert.equal(backend.name, PROJECT);
  return { backend, frontend, runtime, nginx, candidate: manualFirstRelease, deploymentAuthorized: false };
}
