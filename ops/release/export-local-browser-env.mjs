import { appendFileSync, readFileSync } from 'node:fs';
const text = readFileSync('.env.local', 'utf8');
const key = text.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1];
if (!key || !process.env.GITHUB_ENV) throw Error('Missing local browser key or GitHub environment file');
appendFileSync(process.env.GITHUB_ENV, `VITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`);
console.log('Exported local browser configuration; privileged keys excluded');
