import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertLocalConfig } from './local-test.mjs';
const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
test('accepts the isolated local configuration', () => assert.doesNotThrow(() => assertLocalConfig(config)));
for (const [from, to] of [['barber-local-test', 'production'], ['55322', '54322'], ['http://localhost:5173', 'https://production.invalid']]) test(`refuses altered local guard ${from}`, () => assert.throws(() => assertLocalConfig(config.replace(from, to))));
