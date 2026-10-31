import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
const credentials = JSON.parse(fs.readFileSync(new URL('./.cloud-test/credentials.json', import.meta.url)));
export default defineConfig({
  testDir:'./ops/cloud-test/browser',workers:1,retries:0,timeout:120000,
  expect:{timeout:25000},outputDir:'.cloud-test/browser-results',
  use:{baseURL:credentials.appUrl,httpCredentials:{username:'tester',password:credentials.accessPassword,origin:credentials.appUrl},trace:'off',video:'off',screenshot:'only-on-failure'},
});
