// Private local Test configuration only. Never read provider credentials from
// ambient production variables or expose them through Vite.
export function customerOAuthEnv(config = { environment: 'test' }) {
  const invalid = () => { throw Error('Invalid local customer OAuth configuration'); };
  if (!config || config.environment !== 'test' || Object.keys(config).some(key => !['environment', 'google', 'apple'].includes(key))) invalid();
  const values = { GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'false', GOTRUE_EXTERNAL_APPLE_ENABLED: 'false' };
  for (const provider of ['google', 'apple']) {
    const settings = config[provider];
    if (!settings) continue;
    if (typeof settings !== 'object' || Object.keys(settings).some(key => !['clientId', 'secret', 'redirectUri'].includes(key))) invalid();
    if (['clientId', 'secret'].some(key => typeof settings[key] !== 'string' || !settings[key].trim() || settings[key].length > 8192 || /[\r\n\0]/.test(settings[key]))) invalid();
    const prefix = `GOTRUE_EXTERNAL_${provider.toUpperCase()}`;
    values[`${prefix}_ENABLED`] = 'true';
    values[`${prefix}_CLIENT_ID`] = settings.clientId;
    values[`${prefix}_SECRET`] = settings.secret;
    if (provider === 'apple' || settings.redirectUri) {
      let callback;
      try { callback = new URL(settings.redirectUri); } catch { invalid(); }
      if (callback.protocol !== 'https:' || callback.pathname !== '/auth/v1/callback' || callback.username || callback.password || callback.search || callback.hash) invalid();
      values[`${prefix}_REDIRECT_URI`] = callback.href;
    }
  }
  return values;
}
