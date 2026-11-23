import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const source = resolve(process.argv[2] || '.');
const destination = resolve(process.argv[3] || join(source, 'supabase/functions'));
const deno = resolve('node_modules/.bin/deno');
const cache = mkdtempSync(join(tmpdir(), 'barber-edge-offline-'));
try {
  for (const entry of readdirSync(destination, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const file = join(destination, entry.name, 'index.ts');
    const bundle = join(destination, entry.name, 'release.bundle.js');
    execFileSync(deno, ['bundle', '--frozen', '--config', join(source, 'deno.json'), '--lock',
      join(source, 'deno.lock'), join(source, 'supabase/functions', entry.name, 'index.ts'), '-o', bundle],
    { cwd: source, stdio: 'inherit' });
    const graph = execFileSync(deno, ['info', '--json', '--no-config', '--no-remote', '--no-npm', bundle],
      { env: { ...process.env, DENO_DIR: cache }, encoding: 'utf8' });
    const { modules } = JSON.parse(graph);
    if (modules.length !== 1 || modules[0].error || modules[0].dependencies?.length) {
      throw Error('Function bundle has unresolved imports: ' + entry.name);
    }
    // Supabase's pinned gateway enters the worker through index.ts. A small
    // shim keeps the bundle in JavaScript mode and requires only a local file.
    writeFileSync(file, "import './release.bundle.js';\n");
  }
} finally {
  rmSync(cache, { recursive: true, force: true });
}
