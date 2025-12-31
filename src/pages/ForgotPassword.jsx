import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Mail, ArrowRight, ArrowLeft, CheckCircle } from 'lucide-react';
import LanguageSelector from '../components/UI/LanguageSelector';
import ThemeSelector from '../components/UI/ThemeSelector';
import './Login.css';
import './ForgotPassword.css';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleChange = (e) => {
    setEmail(e.target.value);
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      setError(t('auth.emailRequired'));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('validation.invalidEmail'));
      return;
    }

    setIsLoading(true);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setIsLoading(false);
    setIsSuccess(true);
  };

  return (
    <div className="login-page">
      {/* Background Pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>

      {/* Forgot Password Container */}
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

        {isSuccess ? (
          /* Success State */
          <div className="forgot-success animate-fade-in">
            <div className="forgot-success-icon">
              <CheckCircle size={48} strokeWidth={1.5} />
            </div>
            <h1>{t('auth.checkYourEmail')}</h1>
            <p>
              {t('auth.resetLinkSentTo')} <strong>{email}</strong>.
              {t('auth.checkInboxInstructions')}
            </p>
            <div className="forgot-success-note">
              <p>{t('auth.didntReceiveEmail')}</p>
            </div>
            <Link to="/login" className="login-submit">
              <ArrowLeft size={18} strokeWidth={2} />
              {t('auth.backToLogin')}
            </Link>
          </div>
        ) : (
          <>
            {/* Welcome Text */}
            <div className="login-welcome">
              <h1>{t('auth.forgotPassword')}</h1>
              <p>{t('auth.enterEmailForReset')}</p>
            </div>

            {/* Forgot Password Form */}
            <form className="login-form" onSubmit={handleSubmit}>
              {error && (
                <div className="login-error animate-fade-in">
                  {error}
                </div>
              )}

              <div className="login-field">
                <label htmlFor="email">{t('auth.email')}</label>
                <div className="login-input-wrapper">
                  <Mail size={18} strokeWidth={1.5} />
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={email}
                    onChange={handleChange}
                    placeholder="your@email.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="login-submit"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="login-loading">{t('auth.sending')}</span>
                ) : (
                  <>
                    {t('auth.sendResetLink')}
                    <ArrowRight size={18} strokeWidth={2} />
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="login-footer">
              <p>
                <Link to="/login" className="forgot-back-link">
                  <ArrowLeft size={14} strokeWidth={2} />
                  {t('auth.backToLogin')}
                </Link>
              </p>
            </div>
          </>
        )}
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
