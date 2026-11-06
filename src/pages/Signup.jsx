import BrandLogo from '../components/UI/BrandLogo';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GCC_COUNTRIES } from '../constants/countries';
import { getErrorMessage, logErrorSafely } from '../utils/errorMessages';
import './Login.css';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import './Signup.css';
import { registrationService } from '../services/registration.service';
import { pendingRegistration, rememberRegistration, forgetRegistration } from '../lib/pendingRegistration';

export default function Signup() {
  const { t } = useTranslation();
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
  const [emailAlreadyLinked, setEmailAlreadyLinked] = useState(false);
  const errorRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [registration, setRegistration] = useState(pendingRegistration);
  const [verificationBusy, setVerificationBusy] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verified, setVerified] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const verificationPending = useRef(false);
  const cooldown = Math.max(0, Math.ceil(((registration?.resendAt || 0) - clock) / 1000));
  usePublicNavigationBusy(isLoading || Boolean(verificationBusy));
  useEffect(() => {
    if (!registration?.confirmationRequired || verified) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [registration?.confirmationRequired, verified]);
  useEffect(() => { if (error || emailAlreadyLinked) errorRef.current?.focus(); }, [error, emailAlreadyLinked]);

  const verificationAction = async action => {
    if (!registration?.receipt || verificationError === 'registrationExpired' || verificationPending.current || action === 'resend' && cooldown > 0) return;
    verificationPending.current = true; setVerificationBusy(action); setVerificationMessage(''); setVerificationError('');
    try {
      const result = await registrationService[action](registration.receipt);
      if (result.verified) { setVerified(true); forgetRegistration(); setVerificationMessage('registrationVerified'); }
      else if (action === 'resend') {
        const pending = { ...registration, ...result };
        setRegistration(pending); rememberRegistration(pending); setClock(Date.now()); setVerificationMessage('registrationResent');
      } else setVerificationMessage('registrationNotVerified');
    } catch (failure) {
      setVerificationError(failure.message === 'REGISTRATION_EXPIRED' ? 'registrationExpired' : failure.message === 'RATE_LIMITED' ? 'registrationRateLimited' : 'registrationCheckFailed');
      if (failure.message === 'RATE_LIMITED') {
        const pending = { ...registration, resendAt: Date.now() + Math.max(1, failure.retryAfter || 60) * 1000 };
        setRegistration(pending); rememberRegistration(pending); setClock(Date.now());
      }
      if (failure.message === 'REGISTRATION_EXPIRED') forgetRegistration();
    } finally { verificationPending.current = false; setVerificationBusy(''); }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
    setEmailAlreadyLinked(false);
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
    if (isLoading) return;
    if (!validateForm()) return;

    setIsLoading(true);
    setError('');
    setEmailAlreadyLinked(false);

    try {
      const result = await signup({
        name: formData.name,
        email: formData.email,
        phone: `${formData.countryCode} ${formData.phone}`,
        password: formData.password,
      });

      if (result.success) {
        setRegistration(result);
        rememberRegistration(result);
        setClock(Date.now());
        setFormData(previous => ({ ...previous, password: '', confirmPassword: '' }));
        setIsLoading(false);
      } else {
        if (result.error === 'SIGNUP_EMAIL_EXISTS') {
          setEmailAlreadyLinked(true);
          setIsLoading(false);
          return;
        }
        if (['INVALID_PHONE', 'RATE_LIMITED', 'WEAK_PASSWORD', 'INVALID_DETAILS'].includes(result.error)) {
          const keys = { INVALID_PHONE: 'validation.invalidPhone', RATE_LIMITED: 'auth.registrationRateLimited', WEAK_PASSWORD: 'customerAuth.errors.WEAK_PASSWORD', INVALID_DETAILS: 'errors.invalidData' };
          setError(t(keys[result.error])); setIsLoading(false); return;
        }
        // Use errorMessages utility to get user-friendly message
        const errorMessage = result.error 
          ? getErrorMessage(result.error, t('auth.registrationFailed'), t)
          : t('auth.registrationFailed');
        setError(errorMessage);
        setIsLoading(false);
      }
    } catch (error) {
      logErrorSafely(error, 'Signup.handleSubmit');
      const errorMessage = getErrorMessage(error, t('auth.registrationFailed'), t);
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

      {/* Signup Container */}
      <div className="login-container signup-container animate-scale-in">

        {/* Logo */}
        <Link to="/" className="login-logo" aria-label={t('common.brandHome')}>
          <BrandLogo decorative size="auth" tagline={t('nav.dashboard')} />
        </Link>

        {/* Decorative Line */}
        <div className="login-divider">
          <div className="login-divider-line"></div>
          <div className="login-divider-diamond"></div>
          <div className="login-divider-line"></div>
        </div>

        {/* Welcome Text */}
        <div className="login-welcome">
          <h1>{t(verified ? 'auth.registrationVerifiedTitle' : registration ? 'auth.registrationNextTitle' : 'auth.createAccount')}</h1>
          <p role={verified ? 'status' : undefined}>{t(verified ? 'auth.registrationVerified' : registration ? registration.confirmationRequired ? 'auth.registrationConfirmNext' : 'auth.registrationSignInNext' : 'auth.signUpMessage')}</p>
        </div>

        {/* Signup Form */}
        {registration ? <div className="signup-verification" aria-busy={Boolean(verificationBusy)}>
          {registration.email && <p className="signup-verification-email"><bdi>{registration.email}</bdi></p>}
          {verificationMessage && !verified && <p className="signup-verification-status" role="status">{t(`auth.${verificationMessage}`)}</p>}
          {verificationError && <p className="login-error signup-error" role="alert">{t(`auth.${verificationError}`)}</p>}
          {registration.confirmationRequired && !verified && <>
            <button type="button" className="login-submit" disabled={Boolean(verificationBusy) || verificationError === 'registrationExpired'} onClick={() => verificationAction('status')}>{t(verificationBusy === 'status' ? 'auth.registrationChecking' : 'auth.registrationCheck')}</button>
            <button type="button" className="signup-resend" disabled={Boolean(verificationBusy) || cooldown > 0 || verificationError === 'registrationExpired'} onClick={() => verificationAction('resend')}>{t(verificationBusy === 'resend' ? 'auth.registrationResending' : cooldown ? 'auth.registrationResendIn' : 'auth.registrationResend', { seconds: cooldown })}</button>
          </>}
          <Link className={verified || !registration.confirmationRequired ? 'login-submit' : 'signup-sign-in'} to="/login" onClick={event => { if (verificationBusy) event.preventDefault(); }} aria-disabled={Boolean(verificationBusy)}>{t('auth.signIn')}<ArrowRight size={18} aria-hidden="true" /></Link>
        </div> : <form className="login-form" onSubmit={handleSubmit}>
          {(error || emailAlreadyLinked) && (
            <div ref={errorRef} className="login-error signup-error animate-fade-in" role="alert" tabIndex={-1}>
              <p>{emailAlreadyLinked ? t('auth.registrationEmailLinked') : error}</p>
              {emailAlreadyLinked && <Link to="/login">{t('auth.registrationExistingSignIn')}</Link>}
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
        </form>}

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
