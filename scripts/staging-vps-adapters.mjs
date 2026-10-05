import net from 'node:net';
import { validateStagingReleasePolicy } from './staging-vps-verifier.mjs';

const socketPath = '/run/barber-staging-broker.sock';
const sha256 = /^[0-9a-f]{64}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const decimal = /^[1-9]\d*$/;
const evidencePrefixes = Object.freeze({ 'backup.capture': 'backup', 'migration.apply': 'migration', 'images.rollback': 'rollback' });

function fail(message) {
  throw new Error(`Invalid staging VPS adapter request: ${message}`);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    fail(`${name} fields are invalid`);
  }
}

function validateBinding(binding) {
  exactKeys(binding, ['bindingSha256', 'requestId', 'artifactId', 'commit', 'workflowSha256', 'frontendDigest', 'functionsDigest',
    'migrationTreeSha256', 'latestMigration'], 'binding');
  if (!sha256.test(binding.bindingSha256) || !/^[0-9a-f]{40}$/.test(binding.commit) || !sha256.test(binding.workflowSha256)
      || !decimal.test(binding.artifactId) || typeof binding.requestId !== 'string' || binding.requestId.length > 256
      || !/^1123713308:[1-9]\d*:1:[0-9a-f]{32}$/.test(binding.requestId)
      || !digest.test(binding.frontendDigest) || !digest.test(binding.functionsDigest)
      || !digest.test(binding.migrationTreeSha256) || !/^\d{14}_[a-z0-9_]+$/.test(binding.latestMigration)) fail('binding identity is invalid');
}

export function buildStagingAdapterRequest(operation, input, policy) {
  const checked = validateStagingReleasePolicy(policy);
  if (checked.automationReady !== true) fail('automation is disabled by root-owned policy');
  if (!['backup.capture', 'migration.apply', 'images.rollback'].includes(operation)) fail('operation is not allowed');
  exactKeys(input, operation === 'backup.capture' ? ['binding']
    : operation === 'migration.apply' ? ['binding', 'backupEvidenceId']
      : ['binding', 'rejectedFrontendDigest', 'rejectedFunctionsDigest', 'restoreFrontendDigest', 'restoreFunctionsDigest'], 'input');
  validateBinding(input.binding);
  const request = { version: checked.brokerProtocol, operation, project: checked.project,
    bootstrapSource: checked.bootstrapSource, ...input.binding };
  if (operation === 'migration.apply') {
    if (!/^backup-[0-9a-f]{64}$/.test(input.backupEvidenceId)) fail('backupEvidenceId is invalid');
    request.backupEvidenceId = input.backupEvidenceId;
  }
  if (operation === 'images.rollback') {
    for (const key of ['rejectedFrontendDigest', 'rejectedFunctionsDigest', 'restoreFrontendDigest', 'restoreFunctionsDigest']) {
      if (!digest.test(input[key])) fail(`${key} is invalid`);
      request[key] = input[key];
    }
    if (input.restoreFrontendDigest === input.rejectedFrontendDigest && input.restoreFunctionsDigest === input.rejectedFunctionsDigest) {
      fail('rollback must restore a different recorded image tuple');
    }
  }
  const encoded = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(encoded, 'utf8') > 4096) fail('request is oversized');
  return Object.freeze({ request: Object.freeze(request), encoded });
}

export function validateStagingAdapterReply(raw, operation) {
  if (!Object.hasOwn(evidencePrefixes, operation)) fail('operation is not allowed');
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 4096 || !raw.endsWith('\n') || raw.slice(0, -1).includes('\n')) fail('broker reply frame is invalid');
  let reply;
  try { reply = JSON.parse(raw); } catch { fail('broker reply is not JSON'); }
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) || reply.version !== 1 || typeof reply.code !== 'string'
      || raw !== `${JSON.stringify(reply)}\n`) fail('broker reply is invalid');
  if (reply.code !== 'OK') fail(`broker refused ${operation}`);
  exactKeys(reply, ['version', 'code', 'operation', 'evidenceId', 'evidenceSha256'], 'broker success reply');
  if (reply.operation !== operation || typeof reply.evidenceId !== 'string' || !new RegExp(`^${evidencePrefixes[operation]}-[0-9a-f]{64}$`).test(reply.evidenceId)
      || typeof reply.evidenceSha256 !== 'string' || !sha256.test(reply.evidenceSha256)) fail('broker success evidence is invalid');
  return Object.freeze({ status: `${operation}-evidence-recorded`, authorizing: false,
    evidenceId: reply.evidenceId, evidenceSha256: reply.evidenceSha256 });
}

export async function callStagingBroker(operation, input, policy, { connect = net.createConnection } = {}) {
  const frame = buildStagingAdapterRequest(operation, input, policy);
  return new Promise((resolve, reject) => {
    const client = connect({ path: socketPath });
    let response = '';
    const timer = setTimeout(() => { client.destroy(); reject(new Error('Staging broker timed out')); }, 5000);
    client.setEncoding('utf8');
    client.on('connect', () => client.end(frame.encoded));
    client.on('data', (chunk) => { response += chunk; if (Buffer.byteLength(response, 'utf8') > 4096) client.destroy(new Error('Staging broker reply is oversized')); });
    client.on('error', (error) => { clearTimeout(timer); reject(error); });
    client.on('end', () => {
      clearTimeout(timer);
      try { resolve(validateStagingAdapterReply(response, operation)); } catch (error) { reject(error); }
    });
  });
}

export const stagingVpsAdapterPolicy = Object.freeze({ socketPath });
