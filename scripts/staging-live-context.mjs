import assert from 'node:assert/strict';
import { readFileSync, lstatSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { localDockerProbe } from './local-docker-probe.mjs';
import { INSTALL_ROOT, PROJECT, APPROVED_SOURCE } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { validateLiveModels, LIVE_HASHES, LIVE_ROUTES } from './staging-live-backup-format.mjs';

export function privateRoot(path) {
  const stat = lstatSync(path);
  assert.ok(!stat.isSymbolicLink() && stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o077) === 0);
}
export function flushPath(path) {
  const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function readProtected(path) {
  // Fixed caller paths only. Traverse every parent to reject intermediate links.
  assert.ok(path.startsWith(INSTALL_ROOT + '/') || path.startsWith(release.root + '/') || path.startsWith('/etc/barber-staging-backup/')
    || path === '/etc/barber-staging-cloudflared/tunnel-token' || path === '/etc/systemd/system/barber-staging-cloudflared.service');
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const state = lstatSync(parent); assert.ok(state.isDirectory() && !state.isSymbolicLink() && state.uid === 0 && (state.mode & 0o022) === 0);
  }
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o022) === 0);
  assert.ok(stat.size > 0 && stat.size <= 1024 * 1024);
  return readFileSync(path);
}
export function liveContext({ health = true } = {}) {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  privateRoot(INSTALL_ROOT); privateRoot(release.root);
  const original = JSON.parse(readProtected(`${INSTALL_ROOT}/compose.private.json`));
  const prepared = JSON.parse(readProtected(`${INSTALL_ROOT}/prepared.json`));
  assert.equal(prepared.approvedSource, APPROVED_SOURCE);
  assert.equal(checksum(readProtected(`${INSTALL_ROOT}/compose.private.json`)), prepared.composeSha256);
  assert.equal(prepared.composeSha256, LIVE_HASHES.bootstrap);
  const backend = JSON.parse(readProtected(`${release.root}/backend.private-origin.json`));
  const frontend = JSON.parse(readProtected(`${release.root}/frontend.same-origin.json`));
  validateLiveModels(original, backend, frontend);
  assert.equal(checksum(readProtected(`${release.root}/runtime-config.same-origin.js`)), LIVE_HASHES.runtime);
  assert.equal(checksum(readProtected(`${release.root}/nginx.same-origin.conf`)), LIVE_HASHES.nginx);
  const docker = localDockerProbe(); const states = [];
  for (const model of [backend, frontend]) {
    const [network] = JSON.parse(docker(['network', 'inspect', model.name]));
    assert.equal(network.Internal, true);
    for (const [key, value] of Object.entries(model.networks.default.labels)) assert.equal(network.Labels[key], value);
    for (const [name, service] of Object.entries(model.services)) {
      const [state] = JSON.parse(docker(['inspect', service.container_name]));
      assert.equal(state.Config.Image, service.image);
      for (const [key, value] of Object.entries(service.labels)) assert.equal(state.Config.Labels[key], value);
      for (const [key, value] of Object.entries(service.environment || {})) assert.ok(state.Config.Env.includes(`${key}=${value}`));
      assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
      assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [model.name]);
      assert.equal(state.HostConfig.Privileged, false);
      assert.deepEqual(state.HostConfig.CapAdd || [], []);
      if (service.user) assert.equal(state.Config.User, service.user);
      if (service.read_only) assert.equal(state.HostConfig.ReadonlyRootfs, true);
      if (service.cap_drop) assert.deepEqual(state.HostConfig.CapDrop, service.cap_drop);
      if (service.security_opt) assert.deepEqual(state.HostConfig.SecurityOpt, service.security_opt);
      assert.equal(state.HostConfig.Memory, service.mem_limit);
      assert.equal(state.HostConfig.NanoCpus, Math.round(service.cpus * 1000000000));
      assert.equal(state.HostConfig.PidsLimit, service.pids_limit);
      if (health) {
        assert.equal(state.State.Running, true);
        if (state.State.Health) assert.equal(state.State.Health.Status, 'healthy');
      }
      const actualMounts = state.Mounts.filter(mount => mount.Type !== 'tmpfs');
      assert.equal(actualMounts.length, service.volumes.length);
      for (const mount of service.volumes) {
        const actual = actualMounts.find(item => item.Destination === mount.target); assert.ok(actual);
        assert.equal(actual.Type, mount.type);
        if (mount.type === 'volume') {
          assert.equal(actual.Name, model.volumes[mount.source].name);
          const [volume] = JSON.parse(docker(['volume', 'inspect', actual.Name]));
          for (const [key, value] of Object.entries(model.volumes[mount.source].labels)) assert.equal(volume.Labels[key], value);
        } else { assert.equal(actual.Source, mount.source); assert.equal(actual.RW, false); }
      }
      states.push({ id: state.Id, name: service.container_name, image: service.image, healthcheck: Boolean(state.State.Health) });
      if (health || state.State.Running) {
        if (name === 'frontend') assert.equal(`http://${state.NetworkSettings.Networks[model.name].IPAddress}:8080`, LIVE_ROUTES.origins.frontend);
        if (name === 'api-gw') assert.equal(`http://${state.NetworkSettings.Networks[model.name].IPAddress}:8000`, LIVE_ROUTES.origins.api);
      }
    }
  }
  const sql = input => docker(['exec', '-i', '-u', 'postgres', `${PROJECT}-db`, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input }).trim();
  return { original, prepared, backend, frontend, docker, states, sql };
}
export async function resumeStates(docker, states, { waitMs = 180000, pollMs = 1000 } = {}) {
  // Identity checks prevent recovery from starting replacement containers.
  for (const state of states) {
    const [actual] = JSON.parse(docker(['inspect', state.id]));
    assert.equal(actual.Id, state.id); assert.equal(actual.Config.Image, state.image);
    assert.equal(actual.Name, '/' + state.name);
  }
  const db = states.find(state => state.name === `${PROJECT}-db`); assert.ok(db);
  docker(['start', db.id]);
  const wait = async targets => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const running = targets.every(target => {
        const [actual] = JSON.parse(docker(['inspect', target.id]));
        return actual.State.Running && (!actual.State.Health || actual.State.Health.Status === 'healthy');
      });
      if (running) return;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error('STAGING_RESUME_TIMEOUT');
  };
  await wait([db]);
  docker(['start', ...states.filter(state => state.id !== db.id).map(state => state.id)]);
  await wait(states);
}
