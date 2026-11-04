import { initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, PhoneAuthProvider, RecaptchaVerifier } from 'firebase/auth';

let auth;
export async function sendCheckoutPhoneCode(config, phone, container, language) {
  if (config.testPhones && !config.testPhones.includes(phone)) throw new Error('PHONE_TEST_NUMBER');
  auth ||= initializeAuth(initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId,
  }, 'barber-checkout-phone'), { persistence: inMemoryPersistence });
  auth.languageCode = language;
  // Google allows its mock app verifier only for preconfigured fictional numbers.
  auth.settings.appVerificationDisabledForTesting = Boolean(config.testPhones);
  const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
  try {
    return await new PhoneAuthProvider(auth).verifyPhoneNumber(phone, verifier);
  } catch (error) {
    if (['auth/too-many-requests', 'auth/quota-exceeded'].includes(error.code)) throw new Error('PHONE_RATE_LIMIT', { cause: error });
    throw new Error('PHONE_UNAVAILABLE', { cause: error });
  } finally {
    verifier.clear();
  }
}
