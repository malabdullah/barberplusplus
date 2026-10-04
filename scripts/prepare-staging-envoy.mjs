import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { minimalStagingEnvoy } from './staging-envoy-minimal.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Pass the verified upstream directory');
  const root = join(realpathSync(process.argv[2]), 'volumes/api/envoy');
  const config = minimalStagingEnvoy(readFileSync(join(root, 'lds.template.yaml'), 'utf8'), readFileSync(join(root, 'cds.yaml'), 'utf8'));
  const outputs = [['staging-lds.template.yaml', config.listener], ['staging-cds.yaml', config.clusters]];
  if (outputs.some(([file]) => existsSync(join(root, file)))) throw new Error('Refusing to overwrite generated gateway files');
  for (const [file, data] of outputs) writeFileSync(join(root, file), data, { flag: 'wx', mode: 0o644 });
  console.log('Prepared minimal staging gateway templates; no credentials or deployment generated.');
} catch {
  console.error('Staging gateway preparation failed; inspect input identity and existing output paths.');
  process.exitCode = 1;
}
