import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerOAuthEnv } from './customer-oauth-config.mjs';
test('providers default to disabled and are isolated from ambient credentials', () => {
  assert.deepEqual(customerOAuthEnv(), { GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'false', GOTRUE_EXTERNAL_APPLE_ENABLED: 'false' });
});
test('enables a configured Test Google client and requires HTTPS for Apple callbacks', () => {
  assert.equal(customerOAuthEnv({ environment: 'test', google: { clientId: 'test-client', secret: 'test-secret' } }).GOTRUE_EXTERNAL_GOOGLE_ENABLED, 'true');
  assert.equal(customerOAuthEnv({ environment: 'test', google: { clientId: 'test-client', secret: 'test-secret' } }).GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI, 'http://127.0.0.1:55321/auth/v1/callback');
  assert.equal(customerOAuthEnv({ environment: 'test', apple: { clientId: 'test-service', secret: 'test-jwt', redirectUri: 'https://test-auth.example/auth/v1/callback' } }).GOTRUE_EXTERNAL_APPLE_REDIRECT_URI, 'https://test-auth.example/auth/v1/callback');
  for (const redirectUri of ['http://localhost/auth/v1/callback', 'https://test.example/other', 'https://user:secret@test.example/auth/v1/callback']) assert.throws(() => customerOAuthEnv({ environment: 'test', apple: { clientId: 'test', secret: 'secret', redirectUri } }));
});
test('rejects production configuration, unknown options and injected environment lines', () => {
  for (const config of [{ environment: 'production' }, { environment: 'test', SUPABASE_URL: 'remote' }, { environment: 'test', google: { clientId: 'test', secret: 'bad\nINJECTED=1' } }]) assert.throws(() => customerOAuthEnv(config));
});
