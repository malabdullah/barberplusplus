import { validateRuntimeConfig } from './runtimeConfigValidation';

const injectedConfig = typeof window !== 'undefined' ? window.__BARBER_CONFIG__ : null;

const localConfig = {
  environment: import.meta.env.VITE_APP_ENV || import.meta.env.MODE,
  appUrl: import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : ''),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  release: import.meta.env.VITE_APP_RELEASE || 'local',
};

export const appConfig = validateRuntimeConfig(
  injectedConfig?.environment ? injectedConfig : localConfig
);

export const isStaging = appConfig.environment === 'staging';
