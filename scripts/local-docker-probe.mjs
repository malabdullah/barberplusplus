import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';

// Resolve once, then bind every operation to the same local Unix socket. Never
// inherit a later context switch, TCP/SSH endpoint, TLS override or registry env.
export function localDockerProbe({ sourceEnv = process.env, execute = execFileSync,
  resolveSocket = realpathSync, inspectSocket = statSync } = {}) {
  assert.ok(!sourceEnv.DOCKER_HOST && !sourceEnv.DOCKER_CONTEXT, 'Docker endpoint overrides forbidden');
  const env = Object.freeze({ PATH: sourceEnv.PATH, HOME: sourceEnv.HOME });
  const options = { env, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] };
  const context = execute('docker', ['context', 'show'], options).trim();
  assert.match(context, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid Docker context');
  let contexts;
  try { contexts = JSON.parse(execute('docker', ['context', 'inspect', context], options)); }
  catch { throw new Error('Docker context metadata is invalid'); }
  assert.ok(Array.isArray(contexts) && contexts.length === 1, 'Expected one Docker context');
  const host = contexts[0]?.Endpoints?.docker?.Host;
  assert.ok(typeof host === 'string' && /^unix:\/\/\/[^\r\n?#\0]+$/.test(host), 'Local Docker Unix socket required');
  const socket = resolveSocket(host.slice('unix://'.length));
  assert.ok(socket.startsWith('/') && inspectSocket(socket).isSocket(), 'Local Docker endpoint is not a socket');
  const endpoint = `unix://${socket}`;
  return (args, { input, timeout = 180000 } = {}) => execute('docker', ['--host', endpoint, ...args],
    { ...options, timeout, input }).trim();
}
