import { supabase } from '../lib/supabase';
import {
  authRateLimiter,
  signupRateLimiter,
  passwordResetRateLimiter,
  validateUserRole,
  validateRedirectUrl,
} from '../utils/security';
import { getErrorMessage } from '../utils/errorMessages';

export const authService = {
  /**
   * Sign in with email and password
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{user: object, role: string} | null>}
   */
  login: async (email, password) => {
    // SECURITY: Rate limiting to prevent brute force attacks
    const rateLimitCheck = authRateLimiter.check(email.toLowerCase());
    if (!rateLimitCheck.allowed) {
      throw new Error(`Too many login attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.`);
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Don't reset rate limit on failure
      // Map Supabase error to user-friendly message
      const friendlyError = new Error(getErrorMessage(error, 'Invalid email or password'));
      friendlyError.originalError = error;
      throw friendlyError;
    }

    // Reset rate limit on successful login
    authRateLimiter.reset(email.toLowerCase());

    // SECURITY: Validate role - don't default to 'manager'
    const roleValidation = validateUserRole(data.user?.app_metadata?.role);
    if (!roleValidation.valid) {
      // Sign out user with invalid role
      await supabase.auth.signOut();
      throw new Error('Account has invalid role configuration. Please contact support.');
    }

    return { user: data.user, role: roleValidation.role };
  },

  /**
   * Register a new manager account
   * @param {object} userData - { name, email, password, phone }
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  signup: async (userData) => {
    // SECURITY: Rate limiting to prevent abuse
    const rateLimitCheck = signupRateLimiter.check(userData.email.toLowerCase());
    if (!rateLimitCheck.allowed) {
      return { success: false, error: `Too many signup attempts. Please try again in ${Math.ceil(rateLimitCheck.retryAfter / 60)} minutes.` };
    }

    const { data, error } = await supabase.auth.signUp({
      email: userData.email,
      password: userData.password,
      options: {
        data: { name: userData.name, phone: userData.phone }
      }
    });

    if (error) {
      // Map Supabase error to user-friendly message
      const friendlyError = getErrorMessage(error, 'Registration failed. Please try again.');
      return { success: false, error: friendlyError };
    }

    // Reset rate limit on success
    signupRateLimiter.reset(userData.email.toLowerCase());
    return { success: true, user: data.user };
  },

  /**
   * Sign out current user
   */
  logout: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /**
   * Send password reset email
   * @param {string} email
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  resetPassword: async (email) => {
    // SECURITY: Rate limiting to prevent email enumeration/abuse
    const rateLimitCheck = passwordResetRateLimiter.check(email.toLowerCase());
    if (!rateLimitCheck.allowed) {
      return { success: false, error: `Too many reset attempts. Please try again in ${Math.ceil(rateLimitCheck.retryAfter / 60)} minutes.` };
    }

    // SECURITY: Validate redirect URL
    const safeRedirectUrl = validateRedirectUrl(`${window.location.origin}/reset-password`);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: safeRedirectUrl,
    });

    if (error) {
      // Map Supabase error to user-friendly message
      const friendlyError = getErrorMessage(error, 'Failed to send reset email. Please try again.');
      return { success: false, error: friendlyError };
    }

    // Reset rate limit on success
    passwordResetRateLimiter.reset(email.toLowerCase());
    return { success: true };
  },

  /**
   * Get current authenticated user
   * @returns {Promise<object | null>}
   */
  getCurrentUser: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  /**
   * Listen to auth state changes
   * @param {function} callback
   * @returns {function} Unsubscribe function
   */
  onAuthStateChange: (callback) => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
    return () => subscription.unsubscribe();
  },

  // ============================================================
  // MFA (Multi-Factor Authentication) Methods
  // ============================================================

  /**
   * Get MFA factors for current user
   * @returns {Promise<{totp: object[], phone: object[]}>}
   */
  getMfaFactors: async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data;
  },

  /**
   * Enroll a new TOTP factor
   * @returns {Promise<{id: string, qr_code: string, secret: string, uri: string}>}
   */
  enrollTotp: async () => {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator App',
    });
    if (error) throw error;
    return data;
  },

  /**
   * Verify a TOTP factor during enrollment
   * @param {string} factorId - The factor ID from enrollment
   * @param {string} code - The 6-digit TOTP code
   * @returns {Promise<boolean>}
   */
  verifyTotp: async (factorId, code) => {
    const { data, error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (error) throw error;
    return true;
  },

  /**
   * Create MFA challenge for login verification
   * @param {string} factorId - The factor ID to challenge
   * @returns {Promise<{id: string}>}
   */
  createMfaChallenge: async (factorId) => {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) throw error;
    return data;
  },

  /**
   * Verify MFA challenge with TOTP code
   * @param {string} factorId - The factor ID
   * @param {string} challengeId - The challenge ID
   * @param {string} code - The 6-digit TOTP code
   * @returns {Promise<boolean>}
   */
  verifyMfaChallenge: async (factorId, challengeId, code) => {
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (error) throw error;
    return true;
  },

  /**
   * Unenroll an MFA factor
   * @param {string} factorId - The factor ID to remove
   * @returns {Promise<boolean>}
   */
  unenrollMfa: async (factorId) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return true;
  },

  /**
   * Check if user has MFA enabled
   * @returns {Promise<{enabled: boolean, factors: object[]}>}
   */
  checkMfaStatus: async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;

    const verifiedFactors = data.totp?.filter(f => f.status === 'verified') || [];
    return {
      enabled: verifiedFactors.length > 0,
      factors: verifiedFactors,
    };
  },

  /**
   * Get assurance level after MFA
   * @returns {Promise<{currentLevel: string, nextLevel: string | null}>}
   */
  getAssuranceLevel: async () => {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  },
};

export default authService;
