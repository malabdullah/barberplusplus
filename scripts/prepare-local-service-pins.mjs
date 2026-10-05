import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_REST_VERSION = 'v16.4';

// CLI 2.116.0 reads .temp/rest-version (not postgrest-version). This changes
// future local starts only; it never stops a service, resets data or links a DB.
export function prepareLocalServicePins(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.devDependencies?.supabase !== '2.116.0') {
    throw new Error('Review local service override compatibility before changing the Supabase CLI pin');
  }
  const supabase = join(root, 'supabase');
  if (!lstatSync(supabase).isDirectory()) throw new Error('Supabase directory must not be a symlink');
  const config = readFileSync(join(supabase, 'config.toml'), 'utf8');
  const dbSection = config.match(/^\[db\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  if (!dbSection || !/^major_version\s*=\s*17\s*(?:#.*)?$/m.test(dbSection)) {
    throw new Error('Local service pin requires the reviewed PostgreSQL 17 configuration');
  }
  const temp = join(supabase, '.temp');
  try { mkdirSync(temp, { mode: 0o700 }); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (!lstatSync(temp).isDirectory()) throw new Error('Supabase .temp must not be a symlink');
  const pin = join(temp, 'rest-version');
  try {
    writeFileSync(pin, `${LOCAL_REST_VERSION}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = lstatSync(pin);
    if (!info.isFile() || info.nlink !== 1 || info.size > 64) throw new Error('Unsafe existing local REST pin');
    if (readFileSync(pin, 'utf8').trim() !== LOCAL_REST_VERSION) {
      throw new Error('Existing local REST pin differs; preserve it and review before changing it');
    }
  }
  return LOCAL_REST_VERSION;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Local PostgREST pin ready: ${prepareLocalServicePins(process.cwd())}. Existing services are unchanged.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
