import assert from 'node:assert/strict';
import test from 'node:test';
import { localDockerProbe } from './local-docker-probe.mjs';

function fixture(host = 'unix:///var/run/docker.sock', sourceEnv = {}) {
  const calls = [];
  const options = {
    sourceEnv: { PATH: '/usr/bin', HOME: '/synthetic', DOCKER_TLS_VERIFY: '1',
      DOCKER_AUTH_CONFIG: 'must-not-propagate', ...sourceEnv },
    execute: (program, args, settings) => {
      calls.push({ program, args, settings });
      if (args.join() === 'context,show') return 'desktop-linux\n';
      if (args[0] === 'context') return JSON.stringify([{ Endpoints: { docker: { Host: host } } }]);
      return 'ok\n';
    },
    resolveSocket: () => '/resolved/docker.sock',
    inspectSocket: () => ({ isSocket: () => true }),
  };
  return { options, calls };
}

test('binds all operations to one resolved local socket with sanitized environment', () => {
  const { options, calls } = fixture();
  const docker = localDockerProbe(options);
  options.sourceEnv.DOCKER_HOST = 'ssh://not-used.invalid';
  assert.equal(docker(['pull', 'synthetic-image']), 'ok');
  assert.equal(docker(['run', '-i', 'synthetic-image'], { input: 'synthetic', timeout: 90000 }), 'ok');
  for (const call of calls) assert.deepEqual(call.settings.env, { PATH: '/usr/bin', HOME: '/synthetic' });
  for (const call of calls.slice(2)) assert.deepEqual(call.args.slice(0, 2), ['--host', 'unix:///resolved/docker.sock']);
  assert.equal(calls.at(-1).settings.input, 'synthetic');
  assert.equal(calls.at(-1).settings.timeout, 90000);
});

test('rejects endpoint environment overrides before any Docker invocation', () => {
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT']) {
    const { options, calls } = fixture(undefined, { [key]: 'forbidden' });
    assert.throws(() => localDockerProbe(options), /overrides forbidden/);
    assert.equal(calls.length, 0);
  }
});

test('preserves binary recovery archives and never accepts execution overrides', () => {
  const { options, calls } = fixture();
  const execute = options.execute;
  const archive = Buffer.from([0, 10, 32, 255, 13, 10]);
  options.execute = (program, args, settings) => {
    const value = execute(program, args, settings);
    return args[0] === '--host' ? archive : value;
  };
  const docker = localDockerProbe(options);
  assert.deepEqual(docker(['cp', 'synthetic:/archive', '-'], {
    encoding: null, maxBuffer: 1024, env: { DOCKER_HOST: 'ssh://forbidden.invalid' },
  }), archive);
  assert.equal(calls.at(-1).settings.encoding, null);
  assert.equal(calls.at(-1).settings.maxBuffer, 1024);
  assert.deepEqual(calls.at(-1).settings.env, { PATH: '/usr/bin', HOME: '/synthetic' });
});

test('rejects remote endpoints and non-sockets before mutations', () => {
  for (const host of ['tcp://127.0.0.1:2375', 'ssh://remote.invalid', 'unix://relative', 'unix:///socket?remote=1', null]) {
    const { options, calls } = fixture(host);
    assert.throws(() => localDockerProbe(options), /local Docker/i);
    assert.equal(calls.length, 2);
  }
  const { options } = fixture();
  options.inspectSocket = () => ({ isSocket: () => false });
  assert.throws(() => localDockerProbe(options), /not a socket/);
});

test('rejects malformed context metadata without reflecting its content', () => {
  const { options } = fixture();
  options.execute = (_program, args) => args[1] === 'show' ? 'local' : 'do-not-echo';
  assert.throws(() => localDockerProbe(options), (error) => !error.message.includes('do-not-echo'));
});
