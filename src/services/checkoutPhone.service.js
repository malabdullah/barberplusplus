import { initializeApp } from '@firebase/app';
import { initializeAuth, inMemoryPersistence, PhoneAuthProvider, RecaptchaVerifier } from '@firebase/auth';

let auth;
export async function sendCheckoutPhoneCode(config, phone, container, language, signal) {
  auth ||= initializeAuth(initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId,
  }, 'barber-checkout-phone'), { persistence: inMemoryPersistence });
  auth.languageCode = language;
  const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let onAbort;
  try {
    deadline.throwIfAborted();
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(deadline.reason);
      deadline.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([new PhoneAuthProvider(auth).verifyPhoneNumber(phone, verifier), cancelled]);
  } catch (error) {
    if (signal.aborted) throw new Error('PHONE_CANCELLED', { cause: error });
    if (['auth/too-many-requests', 'auth/quota-exceeded'].includes(error.code)) throw new Error('PHONE_RATE_LIMIT', { cause: error });
    throw new Error('PHONE_UNAVAILABLE', { cause: error });
  } finally {
    if (onAbort) deadline.removeEventListener('abort', onAbort);
    verifier.clear();
  }
}
