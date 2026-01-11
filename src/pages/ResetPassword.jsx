import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Lock, Eye, EyeOff, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { validatePassword } from '../utils/validation';
import LanguageSelector from '../components/UI/LanguageSelector';
import ThemeSelector from '../components/UI/ThemeSelector';
import './Login.css';

export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setIsValidSession(true);
        }
      } catch (err) {
        // Session check failed
      }
      setIsCheckingSession(false);
    };

    // Listen for PASSWORD_RECOVERY event from the reset link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsValidSession(true);
        setIsCheckingSession(false);
      }
    });

    checkSession();
    return () => subscription.unsubscribe();
  }, []);

  const validateForm = () => {
    // SECURITY: Use centralized password validation (12+ chars, complexity, common password check)
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.error);
      return false;
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      });

      if (updateError) throw updateError;

      setIsSuccess(true);

      // Redirect to login after short delay
      setTimeout(() => {
        navigate('/login');
      }, 2000);

    } catch (err) {
      setError(err.message || t('errors.resetFailed'));
      setIsLoading(false);
    }
  };

  // Loading state
  if (isCheckingSession) {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <div className="login-logo">
            <div className="login-logo-icon">
              <Scissors size={28} strokeWidth={1.5} />
            </div>
          </div>
          <div className="login-welcome">
            <p>{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  // Invalid or expired link
  if (!isValidSession) {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <div className="auth-preferences">
            <LanguageSelector />
            <ThemeSelector />
          </div>
          <div className="login-logo">
            <div className="login-logo-icon" style={{ background: 'var(--status-error)', color: 'white' }}>
              <AlertCircle size={28} strokeWidth={2} />
            </div>
          </div>
          <div className="login-welcome">
            <h1>{t('auth.invalidResetLink') || 'Invalid Reset Link'}</h1>
            <p>{t('auth.resetLinkExpired') || 'This password reset link is invalid or has expired. Please request a new one.'}</p>
          </div>
          <button
            onClick={() => navigate('/forgot-password')}
            className="login-submit"
          >
            {t('auth.requestNewLink') || 'Request New Link'}
            <ArrowRight size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <div className="login-logo">
            <div className="login-logo-icon" style={{ background: 'var(--status-success)', color: 'white' }}>
              <Check size={28} strokeWidth={2} />
            </div>
          </div>
          <div className="login-welcome">
            <h1>{t('auth.passwordResetSuccess') || 'Password Reset!'}</h1>
            <p>{t('auth.redirectingToLogin') || 'Your password has been updated. Redirecting to login...'}</p>
          </div>
        </div>
      </div>
    );
  }

  // Password reset form
  return (
    <div className="login-page">
      {/* Background Pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>

      {/* Container */}
      <div className="login-container animate-scale-in">
        {/* Preferences Selectors */}
        <div className="auth-preferences">
          <LanguageSelector />
          <ThemeSelector />
        </div>

        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <Scissors size={28} strokeWidth={1.5} />
          </div>
          <div className="login-logo-text">
            <span className="login-logo-name">Barber++</span>
            <span className="login-logo-tagline">Dashboard</span>
          </div>
        </div>

        {/* Decorative Line */}
        <div className="login-divider">
          <div className="login-divider-line"></div>
          <div className="login-divider-diamond"></div>
          <div className="login-divider-line"></div>
        </div>

        {/* Welcome Text */}
        <div className="login-welcome">
          <h1>{t('auth.resetYourPassword') || 'Reset Your Password'}</h1>
          <p>{t('auth.enterNewPassword') || 'Enter your new password below.'}</p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="password">{t('auth.newPassword')}</label>
            <div className="login-input-wrapper">
              <Lock size={18} strokeWidth={1.5} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder={t('auth.atLeast12Chars')}
                autoComplete="new-password"
                required
                minLength={12}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff size={18} strokeWidth={1.5} />
                ) : (
                  <Eye size={18} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
            <div className="login-input-wrapper">
              <Lock size={18} strokeWidth={1.5} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder={t('auth.confirmYourPassword')}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="login-loading">{t('auth.updating') || 'Updating...'}</span>
            ) : (
              <>
                {t('auth.resetPassword')}
                <ArrowRight size={18} strokeWidth={2} />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Floating Elements */}
      <div className="login-float login-float-1">
        <Scissors size={32} strokeWidth={1} />
      </div>
      <div className="login-float login-float-2">
        <Scissors size={24} strokeWidth={1} />
      </div>
      <div className="login-float login-float-3">
        <Scissors size={20} strokeWidth={1} />
      </div>
    </div>
  );
}
