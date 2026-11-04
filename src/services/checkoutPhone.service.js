import { initializeApp } from '@firebase/app';
import { initializeAuth, inMemoryPersistence, PhoneAuthProvider, RecaptchaVerifier } from '@firebase/auth';

let auth;
export async function sendCheckoutPhoneCode(config, phone, container, language) {
  auth ||= initializeAuth(initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId,
  }, 'barber-checkout-phone'), { persistence: inMemoryPersistence });
  auth.languageCode = language;
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
