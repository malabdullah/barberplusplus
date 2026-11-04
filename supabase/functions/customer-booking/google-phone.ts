export type GooglePhoneConfig = {
  apiKey: string;
  projectId: string;
  appId: string;
  testPhones?: string[];
};

type GoogleAction = 'sendVerificationCode' | 'signInWithPhoneNumber';

async function callGooglePhone(config: GooglePhoneConfig, action: GoogleAction, data: Record<string, string>, request: typeof fetch) {
  const url = new URL('https://identitytoolkit.googleapis.com/v1/accounts:' + action);
  url.searchParams.set('key', config.apiKey);
  try {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = String(result.error?.message || '').split(' : ')[0];
      if (/^(INVALID_CODE|SESSION_EXPIRED|INVALID_SESSION_INFO|MISSING_SESSION_INFO|CODE_EXPIRED)$/.test(error)) return null;
      if (response.status === 429 || /^(TOO_MANY_ATTEMPTS_TRY_LATER|QUOTA_EXCEEDED)$/.test(error)) throw Error('PHONE_RATE_LIMIT');
      throw Error('PHONE_UNAVAILABLE');
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'PHONE_RATE_LIMIT') throw error;
    throw Error('PHONE_UNAVAILABLE', { cause: error });
  }
}

export async function startGoogleTestPhone(config: GooglePhoneConfig, phone: string, request = fetch) {
  // No production caller can use this entrypoint. Google issues a session
  // without reCAPTCHA/SMS for fictional numbers configured on this project.
  if (!config.testPhones?.includes(phone)) throw Error('PHONE_TEST_NUMBER');
  const result = await callGooglePhone(config, 'sendVerificationCode', { phoneNumber: phone }, request);
  if (typeof result?.sessionInfo !== 'string') throw Error('PHONE_UNAVAILABLE');
  return result.sessionInfo;
}

export async function confirmGooglePhone(config: GooglePhoneConfig, sessionInfo: string, code: string, expectedPhone: string, request = fetch) {
  if (config.testPhones && !config.testPhones.includes(expectedPhone)) return false;
  const result = await callGooglePhone(config, 'signInWithPhoneNumber', { sessionInfo, code }, request);
  // Google validates the OTP and project-bound session. Ignore its Auth tokens;
  // the verified number must match the contact Barber++ is about to use.
  return typeof result?.idToken === 'string' && result.phoneNumber === expectedPhone;
}
