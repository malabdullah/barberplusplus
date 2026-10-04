import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPlatformImage } from './staging-postgres-candidate.mjs';
import { minimalStagingEnvoy } from './staging-envoy-minimal.mjs';
import { fullStackClient } from './staging-full-stack-client.mjs';
import { isPrivateStorageDenied } from './rehearse-staging-core-recovery.mjs';

export const fullStackImages = Object.freeze({
  'api-gw': 'envoyproxy/envoy@sha256:43b69cf424922cd5d1086cc019dc89197e58d58deac89d36b3c8b67f1a9e8523',
  functions: 'sha256:91d9531131d15f51ff8fb629dcc9251446c0f65b348068cb0a6d430d52e88268',
  realtime: 'sha256:2ea7fb6d3211f8e627985e473329dc5bb1abbbdc810d02784847d0a82bbd092c',
});
const child = Object.freeze({
  functions: 'sha256:4304bfb208a54190aab7347dfe83c362efb7feb88f40ddd99d85c227b31e2c16',
  realtime: 'sha256:78f25384ba6173d08f4dd7969989f5115d986cf4e8923f7906bf4fa00bfd1902',
});
export function fullStackOption(option, platform, coreOption) {
  if (option === undefined) return false;
  assert.equal(option, '--full-stack', 'Unknown full-stack option');
  assert.equal(platform, 'linux/amd64', 'Full-stack candidates are AMD64 only');
  assert.equal(coreOption, '--security-core-candidates', 'Full-stack requires the exact patched core candidates');
  return true;
}
export function realtimeEmulationFlags(hostArchitecture, originalFlags) {
  assert.ok(['arm64', 'aarch64', 'amd64', 'x86_64'].includes(hostArchitecture), 'Unknown local Docker host architecture');
  assert.equal(originalFlags, '-proto_dist inet_tcp', 'Unreviewed Erlang arguments');
  // https://github.com/erlang/otp/issues/10355: AMD64 JIT dual mappings under ARM emulation.
  // Only a local functional rehearsal accommodation, never a native/VPS flag.
  return `${originalFlags}${['arm64', 'aarch64'].includes(hostArchitecture) ? ' +JMsingle true' : ''}`;
}
export function assertNoDefaultRoute(ipv4, ipv6) {
  assert.ok(ipv4.split('\n').slice(1).every((line) => line.trim().split(/\s+/)[1] !== '00000000'), 'Unexpected default route');
  assert.ok(ipv6.split('\n').filter(Boolean).every((line) => {
    const fields = line.trim().split(/\s+/);
    return fields[0] !== '0'.repeat(32) || fields[1] !== '00' || fields.at(-1) === 'lo';
  }), 'Unexpected IPv6 default route');
}
function containerManifest(docker, name) {
  const archive = docker(['cp', `${name}:/home/deno/bundle-manifest.json`, '-'], { encoding: null, maxBuffer: 65536 });
  assert.ok(Buffer.isBuffer(archive) && archive.length <= 65536, 'Oversized Functions manifest archive');
  const options = { input: archive, encoding: 'utf8', timeout: 10000, maxBuffer: 32768,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } };
  assert.equal(execFileSync('/usr/bin/tar', ['-tf', '-'], options).trim(), 'bundle-manifest.json', 'Unexpected manifest archive member');
  // Stream a single reviewed member only: no filesystem extraction/symlinks.
  return JSON.parse(execFileSync('/usr/bin/tar', ['-xOf', '-', 'bundle-manifest.json'], options));
}
export function validateFullStackMetadata(name, metadata) {
  assert.ok(Object.hasOwn(child, name), 'Unknown full-stack candidate');
  assert.equal(`${metadata.Os}/${metadata.Architecture}`, 'linux/amd64');
  assert.equal(metadata.Id, child[name], 'Full-stack candidate child manifest mismatch');
  if (name === 'functions') {
    assert.equal(metadata.Config.User, '10001:10001');
    assert.deepEqual(metadata.Config.Entrypoint, ['edge-runtime']);
    assert.deepEqual(metadata.Config.Cmd, ['start', '--main-service', '/home/deno/bundles/main.eszip']);
    assert.equal(metadata.Config.Labels['cloud.malabdullah.barber.candidate'], 'edge-runtime-security-local-only');
    assert.equal(metadata.Config.Labels['cloud.malabdullah.barber.upstream-manifest'], 'sha256:fded42ff725708990b1a0803633c2659453259d075c4bec6b4d01dfb82dc055e');
    assert.equal(metadata.Config.Labels['org.opencontainers.image.source'], 'https://github.com/supabase/edge-runtime');
  } else {
    assert.equal(metadata.Config.User, '65534:65534');
    assert.equal(metadata.Config.Labels['org.opencontainers.image.source'], 'https://github.com/supabase/realtime');
    assert.equal(metadata.Config.Labels['org.opencontainers.image.revision'], 'e0d1f657161f7f01e9b4be156627d974fdc6918d');
    assert.equal(metadata.Config.Labels['cloud.malabdullah.barber.candidate'], 'realtime-security-local-only');
    assert.deepEqual(metadata.Config.Cmd, ['/app/bin/server']);
    assert.deepEqual(metadata.Config.Entrypoint, ['/usr/bin/tini', '-s', '-g', '--', '/usr/local/bin/barber-realtime-entrypoint']);
  }
}

export async function rehearseFullStack({ model, rendered, upstream, docker, compose, sql, variables, accounts, redactions }) {
  const project = model.name;
  const label = 'barber.staging.core-probe';
  const names = ['realtime', 'functions', 'api-gw'];
  const scratch = mkdtempSync(join(tmpdir(), 'barber-full-stack-'));
  let stage = 'input validation';
  let created = false;
  let removed = false;
  const secrets = { meta: randomBytes(32).toString('hex'), verify: randomBytes(24).toString('hex'), cron: randomBytes(24).toString('hex') };
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  redactions.push(...Object.values(secrets), privateKey);
  try {
    assert.deepEqual(Object.keys(model.services), ['db', 'auth', 'rest', 'storage', 'mailpit']);
    assert.equal(model.networks.default.internal, true);
    for (const name of ['functions', 'realtime']) validateFullStackMetadata(name, inspectPlatformImage(docker, fullStackImages[name], 'linux/amd64'));
    docker(['pull', '--platform', 'linux/amd64', fullStackImages['api-gw']], { timeout: 300000 });
    const gatewayMetadata = inspectPlatformImage(docker, fullStackImages['api-gw'], 'linux/amd64');
    assert.ok(gatewayMetadata.RepoDigests.includes(fullStackImages['api-gw']));
    const root = join(upstream, 'volumes/api/envoy');
    const originalFiles = {
      'docker-entrypoint.sh': '7ae0abaa8d76332d001e60dc29d4f29985890f89e04ee78489abbf680495631d',
      'envoy.yaml': '3697f23b0be9ec5b829f937c600eb9b878f1f778ab510b42ad5e4f14742447e9',
    };
    for (const [file, hash] of Object.entries(originalFiles)) {
      const data = readFileSync(join(root, file));
      assert.equal(createHash('sha256').update(data).digest('hex'), hash);
      writeFileSync(join(scratch, file), data, { mode: 0o644, flag: 'wx' });
    }
    const gateway = minimalStagingEnvoy(readFileSync(join(root, 'lds.template.yaml'), 'utf8'), readFileSync(join(root, 'cds.yaml'), 'utf8'));
    writeFileSync(join(scratch, 'lds.template.yaml'), gateway.listener, { mode: 0o644, flag: 'wx' });
    writeFileSync(join(scratch, 'cds.yaml'), gateway.clusters, { mode: 0o644, flag: 'wx' });
    const base = { restart: 'no', platform: 'linux/amd64', ports: [], networks: { default: {} },
      labels: { [label]: project }, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
      pids_limit: 256, mem_limit: 1073741824, cpus: 1, pull_policy: 'never' };
    const realtime = structuredClone(rendered.services.realtime);
    const profilePath = 'ops/staging-vps/realtime-security/runtime-profile.yml';
    assert.equal(createHash('sha256').update(readFileSync(profilePath)).digest('hex'), 'a991dccc40ca64c42d03cbf7b0ecf9d17b1174eb585a73934367f6f407cb3c9a', 'Unreviewed Realtime runtime profile');
    const profile = JSON.parse(docker(['compose', '-p', project, '-f', '-', '-f', profilePath, 'config', '--format', 'json'],
      { input: JSON.stringify({ services: { realtime: { image: fullStackImages.realtime } } }) })).services.realtime;
    const hostArchitecture = docker(['info', '--format', '{{.Architecture}}']);
    const erlFlags = realtimeEmulationFlags(hostArchitecture, realtime.environment.ERL_AFLAGS);
    if (erlFlags !== realtime.environment.ERL_AFLAGS) console.log('Local ARM-host AMD64 emulation: Erlang +JMsingle true (OTP issue 10355); native/VPS acceptance remains untested.');
    model.services.realtime = { ...realtime, ...base, ...profile, image: fullStackImages.realtime,
      container_name: `${project}-realtime`, volumes: [],
      healthcheck: { test: ['CMD', 'curl', '-q', '--noproxy', '*', '--proto', '=http', '--max-time', '5',
        '--fail', '--silent', '--output', '/dev/null', '--header', `Authorization: Bearer ${variables.ANON_KEY}`,
        'http://localhost:4000/api/tenants/realtime-dev/health'], interval: '5s', timeout: '6s', retries: 30, start_period: '10s' },
      // libcluster_postgres uses the cookie as a LISTEN channel (<=63 bytes).
      environment: { ...realtime.environment, ...profile.environment, ERL_AFLAGS: erlFlags, RELEASE_COOKIE: randomBytes(32).toString('base64url') } };
    redactions.push(model.services.realtime.environment.RELEASE_COOKIE);
    model.services.functions = { ...base, image: fullStackImages.functions, container_name: `${project}-functions`,
      user: '10001:10001', mem_limit: 805306368, volumes: [],
      tmpfs: ['/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700'],
      command: ['start', '--main-service', '/home/deno/bundles/main.eszip'],
      environment: { APP_ENV: 'staging', APP_URL: 'https://staging-barber.malabdullah.cloud',
        SUPABASE_URL: 'http://api-gw:8000', SUPABASE_ANON_KEY: variables.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: variables.SERVICE_ROLE_KEY, JWT_SECRET: variables.JWT_SECRET,
        CRON_SHARED_SECRET: secrets.cron, WHATSAPP_APP_SECRET: secrets.meta, WHATSAPP_VERIFY_TOKEN: secrets.verify,
        WHATSAPP_FLOW_PRIVATE_KEY: privateKey, WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
        OUTBOUND_RECIPIENT_ALLOWLIST: '', OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false' } };
    const gatewayEnv = {};
    for (const name of ['ANON_KEY', 'SERVICE_ROLE_KEY', 'DASHBOARD_USERNAME', 'DASHBOARD_PASSWORD']) gatewayEnv[name] = variables[name];
    for (const name of ['ANON_KEY_ASYMMETRIC', 'SERVICE_ROLE_KEY_ASYMMETRIC', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) gatewayEnv[name] = '';
    model.services['api-gw'] = { ...base, image: fullStackImages['api-gw'], container_name: `${project}-api-gw`,
      user: '10001:10001', mem_limit: 536870912, environment: gatewayEnv, entrypoint: ['/bin/sh'],
      command: ['/docker-entrypoint.sh', '--concurrency', '1'],
      tmpfs: ['/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700', '/etc/envoy:rw,noexec,nosuid,size=16m,uid=10001,gid=10001,mode=0700'],
      volumes: ['docker-entrypoint.sh', 'envoy.yaml', 'lds.template.yaml', 'cds.yaml'].map((file) => ({
        type: 'bind', source: join(scratch, file), target: file === 'docker-entrypoint.sh' ? '/docker-entrypoint.sh' : `/etc/envoy/${file}`, read_only: true,
      })) };
    stage = 'extra service startup'; created = true;
    compose(['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '240', ...names], { timeout: 300000 });
    for (const name of names) {
      stage = `extra service isolation ${name}`;
      const [state] = JSON.parse(docker(['inspect', `${project}-${name}`]));
      assert.equal(state.Config.Labels[label], project);
      assert.equal(state.HostConfig.ReadonlyRootfs, true);
      assert.equal(state.Config.User, name === 'realtime' ? '65534:65534' : '10001:10001');
      assert.equal(Object.keys(state.HostConfig.PortBindings || {}).length, 0);
      assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [project]);
      assert.ok(state.HostConfig.CapDrop.includes('ALL'));
      assert.ok(state.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
      assert.ok(state.Mounts.every((mount) => mount.Type === 'tmpfs' || name === 'api-gw' && mount.Type === 'bind' && !mount.RW
        && model.services[name].volumes.some((expected) => expected.target === mount.Destination
          && [expected.source, `/host_mnt${expected.source}`].includes(mount.Source))));
      if (name === 'functions') {
        // Distroless Functions intentionally has no shell or cat. This bounded,
        // credential-free inspector shares ONLY its network namespace, not
        // its mounts/process namespace. It is not an application service.
        const inspector = `${project}-route-inspector`;
        try {
          const routeData = JSON.parse(docker(['run', '--rm', '--platform', 'linux/amd64',
            '--name', inspector, '--label', `${label}=${project}`, '--network', `container:${project}-functions`,
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--user', '10001:10001', '--memory', '128m', '--cpus', '0.5', '--pids-limit', '64',
            '--entrypoint', 'node', model.services.storage.image, '--input-type=module', '-e',
            "import{readFileSync}from'node:fs';console.log(JSON.stringify(['/proc/net/route','/proc/net/ipv6_route'].map(p=>readFileSync(p,'utf8'))));"], { timeout: 30000 }));
          assertNoDefaultRoute(...routeData);
        } finally {
          const remaining = docker(['ps', '-aq', '--filter', `name=^/${inspector}$`, '--filter', `label=${label}=${project}`]);
          if (remaining) docker(['rm', '-f', inspector]);
        }
      } else {
        assertNoDefaultRoute(docker(['exec', `${project}-${name}`, 'cat', '/proc/net/route']),
          docker(['exec', `${project}-${name}`, 'cat', '/proc/net/ipv6_route']));
      }
    }
    stage = 'compiled Functions source identity';
    const manifest = containerManifest(docker, `${project}-functions`);
    assert.equal(manifest.sourceCommit, 'aecdbc69e6c2f2a37e53d3b54badb1b95f3144fd');
    assert.equal(manifest.treeSha256, '4e4f450952bb29f6a27dc9b1455ab02a75dbbe974b85944ae7c6ef62d3b81bcc');
    stage = 'private Realtime policy';
    const adminId = sql("SELECT id FROM auth.users WHERE email='admin@barber.test';");
    assert.match(adminId, /^[a-f0-9-]{36}$/);
    sql(`CREATE POLICY full_stack_probe_read ON realtime.messages FOR SELECT TO authenticated
      USING ((select auth.uid()) = '${adminId}'::uuid AND realtime.topic()='probe-allowed');
      CREATE POLICY full_stack_probe_write ON realtime.messages FOR INSERT TO authenticated
      WITH CHECK ((select auth.uid()) = '${adminId}'::uuid AND realtime.topic()='probe-allowed');`);
    stage = 'gateway application and websocket checks';
    const input = { anon: variables.ANON_KEY, key: variables.SERVICE_ROLE_KEY, ...secrets,
      password: accounts.find((account) => account.email === 'admin@barber.test').password,
      barberPassword: accounts.find((account) => account.email === 'barber@barber.test').password,
      otherManagerPassword: accounts.find((account) => account.email === 'manager-two@barber.test').password,
      flowPublic: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
    console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'],
      { input: `await (${fullStackClient.toString()})(${JSON.stringify(input)}, (${isPrivateStorageDenied.toString()}));`, timeout: 180000 }));
    stage = 'probe policy cleanup';
    sql('DROP POLICY full_stack_probe_read ON realtime.messages; DROP POLICY full_stack_probe_write ON realtime.messages;');
    console.log('PASS: real eight-service local gateway rehearsal; no VPS/public TLS/Cloudflare or release acceptance.');
  } catch (error) {
    // No raw Docker exceptions: they may include synthetic environment values.
    const detail = String(error.stderr || '').match(/FULLSTACK_ASSERT:[a-zA-Z0-9 _:/.-]+/)?.[0];
    if (detail) console.error(detail);
    for (const line of String(error.stdout || '').split('\n')) {
      if (/^FULLSTACK_PASS: [a-zA-Z ]+$/.test(line)) console.log(line);
    }
    if (stage === 'extra service startup') {
      let diagnostic = String(error.stderr || '').split('\n').slice(-15).join('\n');
      try { diagnostic += '\n' + docker(['logs', '--tail', '60', `${project}-realtime`]); } catch { /* diagnostics cannot obscure cleanup */ }
      for (const secret of redactions) diagnostic = diagnostic.replaceAll(secret, '[synthetic-redacted]');
      console.error(diagnostic.replace(/\b[a-z]+:\/\/[^\s]+/gi, '[URL]').replace(/[A-Za-z0-9_+\/=.-]{48,}/g, '[long-value]'));
    }
    throw new Error(`Full-stack rehearsal failed at ${stage}`);
  } finally {
    if (created) {
      // Keep all services in model if removal fails, so outer scoped cleanup
      // still knows them. Never claim an eight-service recovery test.
      compose(['stop', '--timeout', '10', ...names], { timeout: 60000 });
      compose(['rm', '-f', ...names], { timeout: 60000 });
      removed = true;
    }
    if (!created || removed) {
      for (const name of names) delete model.services[name];
      rmSync(scratch, { recursive: true });
    }
  }
}
