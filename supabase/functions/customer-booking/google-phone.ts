export type GooglePhoneConfig = {
  apiKey: string;
  projectId: string;
  appId: string;
  testPhones?: string[];
};

export async function confirmGooglePhone(config: GooglePhoneConfig, sessionInfo: string, code: string, expectedPhone: string, request = fetch) {
  if (config.testPhones && !config.testPhones.includes(expectedPhone)) return false;
  const url = new URL('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber');
  url.searchParams.set('key', config.apiKey);
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionInfo, code }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (/^(INVALID_CODE|SESSION_EXPIRED|INVALID_SESSION_INFO|MISSING_SESSION_INFO|CODE_EXPIRED)$/.test(result.error?.message)) return false;
    if (response.status === 429 || /^(TOO_MANY_ATTEMPTS_TRY_LATER|QUOTA_EXCEEDED)$/.test(result.error?.message)) throw Error('PHONE_RATE_LIMIT');
    throw Error('PHONE_UNAVAILABLE');
  }
  // Google validates the OTP and project-bound session. Ignore its Auth tokens;
  // the verified number must match the contact Barber++ is about to use.
  return typeof result.idToken === 'string' && result.phoneNumber === expectedPhone;
}
