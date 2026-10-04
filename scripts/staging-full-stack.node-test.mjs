import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrivateStorageDenied } from './rehearse-staging-core-recovery.mjs';
import { assertNoDefaultRoute, fullStackImages, fullStackOption, realtimeEmulationFlags, validateFullStackMetadata } from './staging-full-stack-probe.mjs';

test('gateway Storage authorization gate never accepts invalid JWT or server failure', () => {
  assert.equal(isPrivateStorageDenied(400, { statusCode: '404', error: 'not_found' }), true);
  assert.equal(isPrivateStorageDenied(400, { statusCode: '403', error: 'Unauthorized' }), true);
  assert.equal(isPrivateStorageDenied(400, { statusCode: '401', error: 'InvalidJWT' }), false);
  assert.equal(isPrivateStorageDenied(500, { statusCode: '500', error: 'Unauthorized' }), false);
});

test('network namespace inspection rejects IPv4 and IPv6 external default routes', () => {
  assertNoDefaultRoute('Iface Destination\neth0 000010AC', `${'0'.repeat(32)} 00 lo`);
  assert.throws(() => assertNoDefaultRoute('Iface Destination\neth0 00000000', ''));
  assert.throws(() => assertNoDefaultRoute('Iface Destination', `${'0'.repeat(32)} 00 eth0`));
});

test('Erlang emulation accommodation is restricted to the detected ARM Docker host', () => {
  for (const arch of ['arm64', 'aarch64']) assert.equal(realtimeEmulationFlags(arch, '-proto_dist inet_tcp'), '-proto_dist inet_tcp +JMsingle true');
  for (const arch of ['amd64', 'x86_64']) assert.equal(realtimeEmulationFlags(arch, '-proto_dist inet_tcp'), '-proto_dist inet_tcp');
  assert.throws(() => realtimeEmulationFlags('unknown', '-proto_dist inet_tcp'));
  assert.throws(() => realtimeEmulationFlags('arm64', 'unreviewed'));
});

test('full stack is opt-in and tied to AMD64 security core', () => {
  assert.equal(fullStackOption(undefined, 'linux/arm64'), false);
  assert.equal(fullStackOption('--full-stack', 'linux/amd64', '--security-core-candidates'), true);
  assert.throws(() => fullStackOption('--full-stack', 'linux/arm64', '--security-core-candidates'));
  assert.throws(() => fullStackOption('--full-stack', 'linux/amd64', '--core-candidates'));
  assert.throws(() => fullStackOption('--other', 'linux/amd64', '--security-core-candidates'));
  assert.equal(Object.keys(fullStackImages).length, 3);
});
test('compiled Functions architecture and child identity cannot drift', () => {
  const candidate = { Os: 'linux', Architecture: 'amd64',
    Id: 'sha256:4304bfb208a54190aab7347dfe83c362efb7feb88f40ddd99d85c227b31e2c16',
    Config: { User: '10001:10001', Entrypoint: ['edge-runtime'], Cmd: ['start', '--main-service', '/home/deno/bundles/main.eszip'],
      Labels: { 'cloud.malabdullah.barber.candidate': 'edge-runtime-security-local-only',
        'cloud.malabdullah.barber.upstream-manifest': 'sha256:fded42ff725708990b1a0803633c2659453259d075c4bec6b4d01dfb82dc055e',
        'org.opencontainers.image.source': 'https://github.com/supabase/edge-runtime' } } };
  validateFullStackMetadata('functions', candidate);
  for (const change of [{ Id: fullStackImages.functions }, { Architecture: 'arm64' }, { Config: { ...candidate.Config, User: 'root' } }]) {
    assert.throws(() => validateFullStackMetadata('functions', { ...candidate, ...change }));
  }
});

test('Realtime requires exact provenance, unprivileged user and guarded entrypoint', () => {
  const candidate = { Os: 'linux', Architecture: 'amd64',
    Id: 'sha256:78f25384ba6173d08f4dd7969989f5115d986cf4e8923f7906bf4fa00bfd1902',
    Config: { User: '65534:65534', Cmd: ['/app/bin/server'],
      Entrypoint: ['/usr/bin/tini', '-s', '-g', '--', '/usr/local/bin/barber-realtime-entrypoint'],
      Labels: { 'org.opencontainers.image.source': 'https://github.com/supabase/realtime',
        'org.opencontainers.image.revision': 'e0d1f657161f7f01e9b4be156627d974fdc6918d',
        'cloud.malabdullah.barber.candidate': 'realtime-security-local-only' } } };
  validateFullStackMetadata('realtime', candidate);
  for (const config of [{ User: 'root' }, { Entrypoint: ['/app/run.sh'] }, { Labels: {} }, { Cmd: ['/bin/sh'] }]) {
    assert.throws(() => validateFullStackMetadata('realtime', { ...candidate, Config: { ...candidate.Config, ...config } }));
  }
  assert.throws(() => validateFullStackMetadata('realtime', { ...candidate, Id: fullStackImages.realtime }));
  assert.throws(() => validateFullStackMetadata('other', candidate));
});
