import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  challenge: null, send: vi.fn(), clear: vi.fn(), render: vi.fn(), reset: vi.fn(),
}));
vi.mock('@firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('@firebase/auth', () => ({
  initializeAuth: vi.fn(() => ({})),
  inMemoryPersistence: {},
  RecaptchaVerifier: class {
    render() { return firebase.render(); }
    verify() { return firebase.challenge; }
    clear() { firebase.clear(); }
  },
  PhoneAuthProvider: class {
    async verifyPhoneNumber(phone, verifier) {
      const token = await verifier.verify();
      return firebase.send(phone, token);
    }
  },
}));

import { sendCheckoutPhoneCode } from './checkoutPhone.service';

const config = { apiKey: 'test-key', projectId: 'test-project', appId: 'test-app' };
let resolveChallenge;
let controller;
let container;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  controller = new AbortController();
  container = document.createElement('div');
  firebase.challenge = new Promise(resolve => { resolveChallenge = resolve; });
  firebase.render.mockResolvedValue(7);
  firebase.send.mockResolvedValue('verification-session');
  vi.stubGlobal('grecaptcha', { reset: firebase.reset });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('checkout phone challenge lifecycle', () => {
  it('keeps a challenge open beyond two minutes and returns the successful SMS session', async () => {
    const result = sendCheckoutPhoneCode(config, '+96550000099', container, 'en', controller.signal);
    let settled = false;
    result.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(settled).toBe(false);
    expect(firebase.send).not.toHaveBeenCalled();
    expect(firebase.clear).not.toHaveBeenCalled();
    resolveChallenge('valid-captcha-token');
    await expect(result).resolves.toBe('verification-session');
    expect(firebase.send).toHaveBeenCalledExactlyOnceWith('+96550000099', 'valid-captcha-token');
    expect(firebase.clear).toHaveBeenCalledOnce();
  });

  it('cancels immediately and never sends an SMS if a cancelled CAPTCHA later resolves', async () => {
    const result = sendCheckoutPhoneCode(config, '+96550000099', container, 'en', controller.signal);
    const rejected = expect(result).rejects.toThrow('PHONE_CANCELLED');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(firebase.reset).toHaveBeenCalledWith(7);
    expect(firebase.clear).toHaveBeenCalledOnce();
    resolveChallenge('late-captcha-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(firebase.send).not.toHaveBeenCalled();
  });

  it('does not launch a challenge when the caller has already cancelled', async () => {
    controller.abort();
    await expect(sendCheckoutPhoneCode(config, '+96550000099', container, 'ar', controller.signal)).rejects.toThrow('PHONE_CANCELLED');
    expect(firebase.render).not.toHaveBeenCalled();
    expect(firebase.send).not.toHaveBeenCalled();
  });

  it('releases the challenge and preserves Firebase rate-limit errors', async () => {
    firebase.send.mockRejectedValue({ code: 'auth/too-many-requests' });
    const result = sendCheckoutPhoneCode(config, '+96550000099', container, 'en', controller.signal);
    const rejected = expect(result).rejects.toThrow('PHONE_RATE_LIMIT');
    resolveChallenge('valid-captcha-token');
    await rejected;
    expect(firebase.clear).toHaveBeenCalledOnce();
  });
});
