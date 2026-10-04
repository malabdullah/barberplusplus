import { createHash } from 'node:crypto';
import { stagingEnvoyCors } from './staging-envoy-cors.mjs';

const clustersHash = '1d7514b891370ed27c25911df008887402e16ab09273e6e433225bb7f09f7905';

// Only transform the reviewed source, never rendered configuration or secrets.
export function minimalStagingEnvoy(listener, clusters) {
  let restricted = stagingEnvoyCors(listener);
  if (typeof clusters !== 'string' || createHash('sha256').update(clusters).digest('hex') !== clustersHash) {
    throw new Error('Refusing unreviewed upstream gateway clusters');
  }
  const route = (cluster, rewrite = '') => `                        route:\n                          cluster: ${cluster}\n${rewrite ? `                          prefix_rewrite: ${rewrite}\n` : ''}                          timeout: 30s\n`;
  const denied = '                        direct_response:\n                          status: 403\n';
  for (const [block, count] of [[route('meta', '/'), 1], [route('studio', '/api/mcp'), 1], [route('studio'), 2]]) {
    if (restricted.split(block).length !== count + 1) throw new Error('Unexpected optional gateway route structure');
    restricted = restricted.replaceAll(block, denied);
  }
  const separator = "  - '@type': type.googleapis.com/envoy.config.cluster.v3.Cluster\n";
  const blocks = clusters.split(separator);
  if (blocks.length !== 8 || blocks[0] !== 'resources:\n') throw new Error('Unexpected upstream cluster structure');
  const retained = blocks.slice(1).filter((block) => !/^    name: (studio|meta)\n/.test(block));
  if (retained.length !== 5) throw new Error('Unexpected minimal gateway cluster inventory');
  // Use the service DNS name: the VPS has its own container name, not the
  // upstream realtime-dev.supabase-realtime container identity.
  const reduced = ('resources:\n' + retained.map((block) => separator + block).join(''))
    .replace('address: realtime-dev.supabase-realtime', 'address: realtime');
  return { listener: restricted, clusters: reduced };
}
