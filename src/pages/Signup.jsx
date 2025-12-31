import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GCC_COUNTRIES } from '../constants/countries';
import LanguageSelector from '../components/UI/LanguageSelector';
import ThemeSelector from '../components/UI/ThemeSelector';
import './Login.css';
import './Signup.css';

export default function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signup } = useApp();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    countryCode: '+965',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError(t('validation.nameRequired'));
      return false;
    }
    if (!formData.email.trim()) {
      setError(t('validation.emailRequired'));
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError(t('validation.invalidEmail'));
      return false;
    }
    if (!formData.phone.trim()) {
      setError(t('validation.phoneRequired'));
      return false;
    }
    // Strong password validation
    if (formData.password.length < 8) {
      setError(t('validation.passwordLength'));
      return false;
    }
    if (!/[A-Z]/.test(formData.password)) {
      setError(t('validation.passwordUppercase'));
      return false;
    }
    if (!/[a-z]/.test(formData.password)) {
      setError(t('validation.passwordLowercase'));
      return false;
    }
    if (!/[0-9]/.test(formData.password)) {
      setError(t('validation.passwordNumber'));
      return false;
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(formData.password)) {
      setError(t('validation.passwordSpecial'));
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError(t('validation.passwordsMismatch'));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsLoading(true);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await signup({
      name: formData.name,
      email: formData.email,
      phone: `${formData.countryCode} ${formData.phone}`,
      password: formData.password,
    });

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error || t('auth.registrationFailed'));
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

      {/* Signup Container */}
      <div className="login-container signup-container animate-scale-in">
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
          <h1>{t('auth.createAccount')}</h1>
          <p>{t('auth.signUpMessage')}</p>
        </div>

        {/* Signup Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="name">{t('common.fullName')}</label>
            <div className="login-input-wrapper">
              <User size={18} strokeWidth={1.5} />
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder={t('auth.namePlaceholder')}
                autoComplete="name"
              />
            </div>
          </div>

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
            <label htmlFor="phone">{t('auth.phoneNumber')}</label>
            <div className="signup-phone-wrapper">
              <select
                name="countryCode"
                value={formData.countryCode}
                onChange={handleChange}
                className="signup-country-select"
              >
                {GCC_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
              <div className="login-input-wrapper signup-phone-input">
                <Phone size={18} strokeWidth={1.5} />
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="XXXX XXXX"
                  autoComplete="tel"
                />
              </div>
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
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete="new-password"
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
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder={t('auth.repeatPassword')}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff size={18} strokeWidth={1.5} />
                ) : (
                  <Eye size={18} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="login-loading">{t('auth.creatingAccount')}</span>
            ) : (
              <>
                {t('auth.createAccount')}
                <ArrowRight size={18} strokeWidth={2} />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="login-footer">
          <p>{t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link></p>
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
