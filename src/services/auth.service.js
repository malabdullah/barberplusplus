import { supabase } from '../lib/supabase';

export const authService = {
  /**
   * Sign in with email and password
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{user: object, role: string} | null>}
   */
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { user: data.user, role: data.user?.user_metadata?.role || 'manager' };
  },

  /**
   * Register a new manager account
   * @param {object} userData - { name, email, password, phone }
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  signup: async (userData) => {
    const { data, error } = await supabase.auth.signUp({
      email: userData.email,
      password: userData.password,
      options: {
        data: { name: userData.name, phone: userData.phone, role: 'manager' }
      }
    });
    if (error) return { success: false, error: error.message };
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { success: false, error: error.message };
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
