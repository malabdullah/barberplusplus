import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './runtimeConfigValidation';

const localAnonKey = [
  btoa(JSON.stringify({ alg: 'none' })),
  btoa(JSON.stringify({ role: 'anon' })),
  'test-signature',
].join('.');

describe('validateRuntimeConfig', () => {
  it('requires Cloud Test to explicitly select its own HTTPS backend', () => {
    const config = { environment: 'cloud-test', appUrl: 'https://test.example.com', cloudTestProjectRef: 'abcdefghijklmnopqrst', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: 'sb_publishable_example' };
    expect(validateRuntimeConfig(config).environment).toBe('cloud-test');
    expect(() => validateRuntimeConfig({...config, supabaseUrl: 'https://another.supabase.co'})).toThrow(/selected Supabase project/);
    expect(() => validateRuntimeConfig({...config, appUrl: 'http://test.example.com'})).toThrow(/HTTPS/);
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

  it('requires HTTPS for production', () => {
    expect(() => validateRuntimeConfig({
      environment: 'production',
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
