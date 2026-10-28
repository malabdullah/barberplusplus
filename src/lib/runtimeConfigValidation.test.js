import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './runtimeConfigValidation';

const localAnonKey = [
  btoa(JSON.stringify({ alg: 'none' })),
  btoa(JSON.stringify({ role: 'anon' })),
  'test-signature',
].join('.');

describe('validateRuntimeConfig', () => {
  const preview = {
    environment: 'staging',
    appUrl: 'https://fixture-5180.use.devtunnels.ms',
    supabaseUrl: 'https://fixture-5180.use.devtunnels.ms',
    supabasePublishableKey: 'sb_publishable_example',
  };
  it.each(['test', 'staging'])('retains the selected cloud %s profile over HTTPS', (cloudProfile) => {
    expect(validateRuntimeConfig({ ...preview, cloudProfile })).toMatchObject({ cloudProfile });
  });
  it.each(['test', 'staging'])('allows cloud %s on isolated loopback origins', (cloudProfile) => {
    expect(validateRuntimeConfig({ ...preview, environment: 'test', cloudProfile,
      appUrl: 'http://127.0.0.1:55173', supabaseUrl: 'http://127.0.0.1:55321',
    })).toMatchObject({ cloudProfile });
  });
  it.each([
    { cloudProfile: 'production' },
    { cloudProfile: null },
    { cloudProfile: 'test', environment: 'production' },
    { cloudProfile: 'test', environment: 'development' },
    { cloudProfile: 'test', environment: 'test' },
    { cloudProfile: 'test', supabaseUrl: 'https://other-5180.use.devtunnels.ms' },
    { cloudProfile: 'test', appUrl: 'https://app.example.com', supabaseUrl: 'https://app.example.com' },
    { cloudProfile: 'test', appUrl: 'https://fixture-5180.use.devtunnels.ms.evil.example', supabaseUrl: 'https://fixture-5180.use.devtunnels.ms.evil.example' },
    { cloudProfile: 'test', appUrl: 'https://fixture-5180.use.devtunnels.ms:8443', supabaseUrl: 'https://fixture-5180.use.devtunnels.ms:8443' },
  ])('rejects incompatible cloud profile configuration %#', (override) => {
    expect(() => validateRuntimeConfig({ ...preview, ...override })).toThrow();
  });
  it('accepts loopback HTTP for development', () => {
    expect(validateRuntimeConfig({
      environment: 'development',
      appUrl: 'http://127.0.0.1:5173',
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: localAnonKey,
    })).toMatchObject({ environment: 'development' });
  });

  it('rejects a remote backend in development', () => {
    expect(() => validateRuntimeConfig({
      environment: 'development',
      appUrl: 'http://127.0.0.1:5173',
      supabaseUrl: 'https://database.example.com',
      supabasePublishableKey: localAnonKey,
    })).toThrow(/loopback host/);
  });

  it('requires HTTPS for staging and production', () => {
    expect(() => validateRuntimeConfig({
      environment: 'staging',
      appUrl: 'https://staging.example.com',
      supabaseUrl: 'http://database.example.com',
      supabasePublishableKey: 'sb_publishable_example',
    })).toThrow(/HTTPS/);
  });

  it('rejects secret keys in browser configuration', () => {
    expect(() => validateRuntimeConfig({
      environment: 'production',
      appUrl: 'https://app.example.com',
      supabaseUrl: 'https://database.example.com',
      supabasePublishableKey: 'sb_secret_do_not_expose',
    })).toThrow(/publishable/);
  });

  it('rejects credentials and paths in configured origins', () => {
    expect(() => validateRuntimeConfig({
      environment: 'production',
      appUrl: 'https://user:password@app.example.com/private',
      supabaseUrl: 'https://database.example.com',
      supabasePublishableKey: 'sb_publishable_example',
    })).toThrow(/without credentials/);
  });

  it('rejects unknown environment names', () => {
    expect(() => validateRuntimeConfig({
      environment: 'preview',
      appUrl: 'https://app.example.com',
      supabaseUrl: 'https://database.example.com',
      supabasePublishableKey: 'sb_publishable_example',
    })).toThrow(/APP_ENV/);
  });
});
