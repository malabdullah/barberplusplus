import { initializeApp } from '@firebase/app';
import { initializeAuth, inMemoryPersistence, PhoneAuthProvider, RecaptchaVerifier } from '@firebase/auth';

let auth;
export async function sendCheckoutPhoneCode(config, phone, container, language, signal) {
  if (signal.aborted) throw new Error('PHONE_CANCELLED', { cause: signal.reason });
  auth ||= initializeAuth(initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId,
  }, 'barber-checkout-phone'), { persistence: inMemoryPersistence });
  auth.languageCode = language;
  let widgetId;
  const resetChallenge = () => {
    if (widgetId !== undefined) window.grecaptcha?.reset(widgetId);
  };
  class CheckoutRecaptchaVerifier extends RecaptchaVerifier {
    async verify() {
      signal.throwIfAborted();
      widgetId = await this.render();
      if (signal.aborted) resetChallenge();
      signal.throwIfAborted();
      const token = await super.verify();
      // Clearing a Firebase verifier does not cancel its pending Promise.
      // Never release a late CAPTCHA token to the SMS sender after cancellation.
      signal.throwIfAborted();
      return token;
    }
  }
  const verifier = new CheckoutRecaptchaVerifier(auth, container, { size: 'invisible' });
  let onAbort;
  try {
    signal.throwIfAborted();
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    // A customer can need several minutes for Google's interactive challenge.
    // Firebase bounds its own network requests; do not time out human input.
    return await Promise.race([new PhoneAuthProvider(auth).verifyPhoneNumber(phone, verifier), cancelled]);
  } catch (error) {
    if (signal.aborted) throw new Error('PHONE_CANCELLED', { cause: error });
    if (['auth/too-many-requests', 'auth/quota-exceeded'].includes(error.code)) throw new Error('PHONE_RATE_LIMIT', { cause: error });
    throw new Error('PHONE_UNAVAILABLE', { cause: error });
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    try {
      if (signal.aborted) resetChallenge();
    } finally {
      verifier.clear();
      container.replaceChildren();
    }
  }
}
