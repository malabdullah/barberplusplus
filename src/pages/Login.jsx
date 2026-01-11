import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import LanguageSelector from '../components/UI/LanguageSelector';
import ThemeSelector from '../components/UI/ThemeSelector';
import { getErrorMessage, logErrorSafely } from '../utils/errorMessages';
import './Login.css';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useApp();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      setError(t('validation.emailPasswordRequired'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const role = await login(formData.email, formData.password);

      if (role) {
        // Redirect based on role
        if (role === 'barber') {
          navigate('/barber');
        } else if (role === 'admin') {
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      } else {
        // Login returned null - this shouldn't happen if error was thrown
        setError(t('auth.invalidCredentials'));
        setIsLoading(false);
      }
    } catch (error) {
      logErrorSafely(error, 'Login.handleSubmit');
      // Use errorMessages utility to get user-friendly message
      const errorMessage = getErrorMessage(error, t('auth.invalidCredentials'));
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Background Pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>

      {/* Login Container */}
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
          <h1>{t('auth.welcomeBack')}</h1>
          <p>{t('auth.signInMessage')}</p>
        </div>

        {/* Login Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="email">{t('common.email')}</label>
            <div className="login-input-wrapper">
              <Mail size={18} strokeWidth={1.5} />
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder={t('auth.emailPlaceholder')}
                autoComplete="email"
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">{t('auth.password')}</label>
            <div className="login-input-wrapper">
              <Lock size={18} strokeWidth={1.5} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                autoComplete="current-password"
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

          <div className="login-options">
            <label className="login-remember">
              <input type="checkbox" />
              <span>{t('auth.rememberMe')}</span>
            </label>
            <Link to="/forgot-password" className="login-forgot">
              {t('auth.forgotPassword')}
            </Link>
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="login-loading">{t('auth.signingIn')}</span>
            ) : (
              <>
                {t('auth.signIn')}
                <ArrowRight size={18} strokeWidth={2} />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="login-footer">
          <p>{t('auth.noAccount')} <Link to="/signup">{t('auth.signUp')}</Link></p>
        </div>
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
