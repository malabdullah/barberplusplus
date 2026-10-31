import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {hash} = require('blake3-wasm');
const stateDirectory = '.cloud-test';
const operation = process.argv[2] || 'manifest';
const config = JSON.parse(await fs.readFile('wrangler.cloud-test.jsonc', 'utf8'));
if (operation === 'manifest') {
  const runtime = {environment:'cloud-test',appUrl:config.vars.APP_URL,supabaseUrl:config.vars.SUPABASE_URL,
    cloudTestProjectRef:new URL(config.vars.SUPABASE_URL).hostname.split('.')[0],supabasePublishableKey:config.vars.SUPABASE_PUBLISHABLE_KEY,release:process.env.APP_RELEASE || 'cloud-test'};
  await fs.writeFile('dist/runtime-config.js', `window.__BARBER_CONFIG__ = Object.freeze(${JSON.stringify(runtime)});\n`);
  const manifest = {};
  for (const file of await fs.readdir('dist', {recursive:true})) {
    const full = path.join('dist', file);
    if (!(await fs.stat(full)).isFile()) continue;
    const bytes = await fs.readFile(full);
    manifest[`/${file}`] = {hash:hash(bytes.toString('base64') + path.extname(file).slice(1)).toString('hex').slice(0,32),size:bytes.length};
  }
  await fs.writeFile(path.join(stateDirectory, 'asset-manifest.json'), JSON.stringify(manifest));
  console.log(`Prepared ${Object.keys(manifest).length} assets.`);
} else if (operation === 'upload') {
  const session = JSON.parse(await fs.readFile(path.join(stateDirectory,'asset-session.json'),'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(stateDirectory,'asset-manifest.json'),'utf8'));
  const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.txt':'text/plain','.webp':'image/webp'};
  let completion = session.buckets.length ? '' : session.jwt;
  for (const bucket of session.buckets) {
    const form = new FormData();
    for (const fileHash of bucket) {
      const [file] = Object.entries(manifest).find(([,item]) => item.hash === fileHash);
      const bytes = await fs.readFile(path.join('dist',file));
      form.append(fileHash,new Blob([bytes.toString('base64')],{type:mime[path.extname(file)] || 'application/octet-stream'}),fileHash);
    }
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/assets/upload?base64=true`,{
      method:'POST',headers:{Authorization:`Bearer ${session.jwt}`},body:form,
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(JSON.stringify({status:response.status,errors:result.errors}));
    completion = result.result.jwt || completion;
    console.log(`Uploaded ${bucket.length} assets.`);
  }
  if (!completion) throw new Error('Asset upload did not return a completion token.');
  await fs.writeFile(path.join(stateDirectory,'asset-completion.json'),JSON.stringify({jwt:completion}),{mode:0o600});
}
