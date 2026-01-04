import { supabase } from '../lib/supabase';
import {
  authRateLimiter,
  signupRateLimiter,
  passwordResetRateLimiter,
  validateUserRole,
  validateRedirectUrl,
} from '../utils/security';

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
      throw error;
    }

    // Reset rate limit on successful login
    authRateLimiter.reset(email.toLowerCase());

    // SECURITY: Validate role - don't default to 'manager'
    const roleValidation = validateUserRole(data.user?.user_metadata?.role);
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
        data: { name: userData.name, phone: userData.phone, role: 'manager' }
      }
    });

    if (error) return { success: false, error: error.message };

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

    if (error) return { success: false, error: error.message };

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
};

export default authService;
