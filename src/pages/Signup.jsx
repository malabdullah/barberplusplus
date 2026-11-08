import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { useApp } from '../context/AppContext';
import { GCC_COUNTRIES } from '../constants/countries';
import { getErrorMessage, logErrorSafely } from '../utils/errorMessages';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import './Signup.css';
import { registrationService } from '../services/registration.service';
import { pendingRegistration, rememberRegistration, forgetRegistration } from '../lib/pendingRegistration';
import RegistrationEmailCorrection from '../components/Customer/RegistrationEmailCorrection';

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
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verified, setVerified] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const verificationPending = useRef(false);
  const cooldown = Math.max(0, Math.ceil(((registration?.resendAt || 0) - clock) / 1000));
  usePublicNavigationBusy(isLoading || Boolean(verificationBusy) || correctionBusy);
  useEffect(() => {
    if (!registration?.confirmationRequired || verified) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [registration?.confirmationRequired, verified]);
  useEffect(() => { if (error || emailAlreadyLinked) errorRef.current?.focus(); }, [error, emailAlreadyLinked]);

  const verificationAction = async action => {
    if (!registration?.receipt || correctionBusy || verificationError === 'registrationExpired' || verificationPending.current || action === 'resend' && cooldown > 0) return;
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
    if (formData.name.trim().length < 2 || formData.name.trim().length > 120) {
      setError(t('validation.nameRequired'));
      return false;
    }
    if (!formData.email.trim()) {
      setError(t('validation.emailRequired'));
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim()) || formData.email.trim().length > 254) {
      setError(t('validation.invalidEmail'));
      return false;
    }
    if (!formData.phone.trim()) {
      setError(t('validation.phoneRequired'));
      return false;
    }
    const country = GCC_COUNTRIES.find(item => item.code === formData.countryCode);
    if (!country?.pattern.test(formData.phone.replace(/[\s()-]/g, ''))) {
      setError(t('validation.invalidPhone'));
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

  const passwordField = (name, label, visible, toggle) => <div className="ca-field">
    <label className="cb-field-label" htmlFor={name}>{label}</label>
    <div className="ca-password">
      <input className="cb-input" id={name} name={name} type={visible ? 'text' : 'password'} autoComplete="new-password" value={formData[name]} onChange={handleChange} required />
      <button type="button" aria-label={t(`customerAuth.${visible ? 'hidePassword' : 'showPassword'}`)} onClick={() => toggle(value => !value)}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
    </div>
  </div>;

  return <CustomerAuthLayout accountType="team" backTo="/login" backLabel={t('auth.backToLogin')}
    title={t(verified ? 'auth.registrationVerifiedTitle' : registration ? 'auth.registrationNextTitle' : 'auth.createManagerAccount')}
    intro={t(verified ? 'auth.registrationVerified' : registration ? registration.confirmationRequired ? 'auth.registrationConfirmNext' : 'auth.registrationSignInNext' : 'managerOnboarding.signupIntro')}>
    {registration ? <div className="signup-verification" aria-busy={Boolean(verificationBusy) || correctionBusy}>
      {registration.email && <p className="signup-verification-email"><bdi>{registration.email}</bdi></p>}
      {verificationMessage && !verified && <p className="signup-verification-status" role="status">{t(`auth.${verificationMessage}`)}</p>}
      {verificationError && <p className="cb-alert" role="alert">{t(`auth.${verificationError}`)}</p>}
      {registration.confirmationRequired && !verified && <>
        <button type="button" className="cb-primary" disabled={Boolean(verificationBusy) || correctionBusy || verificationError === 'registrationExpired'} onClick={() => verificationAction('status')}>{t(verificationBusy === 'status' ? 'auth.registrationChecking' : 'auth.registrationCheck')}</button>
        <button type="button" className="cb-secondary" disabled={Boolean(verificationBusy) || correctionBusy || cooldown > 0 || verificationError === 'registrationExpired'} onClick={() => verificationAction('resend')}>{t(verificationBusy === 'resend' ? 'auth.registrationResending' : cooldown ? 'auth.registrationResendIn' : 'auth.registrationResend', { seconds: cooldown })}</button>
        <RegistrationEmailCorrection email={registration.email} audience="team" disabled={Boolean(verificationBusy)} onBusy={setCorrectionBusy} onCorrected={result => {
          const pending = { ...registration, ...result }; setRegistration(pending); rememberRegistration(pending); setClock(Date.now()); setVerificationError(''); setVerificationMessage(result.delivered ? 'registrationCorrected' : 'registrationCorrectionDeliveryFailed');
        }} />
      </>}
      <Link className={verified || !registration.confirmationRequired ? 'cb-primary' : 'signup-sign-in'} to="/login" onClick={event => { if (verificationBusy || correctionBusy) event.preventDefault(); }} aria-disabled={Boolean(verificationBusy) || correctionBusy}>{t('auth.signIn')}<ArrowRight size={18} aria-hidden="true" /></Link>
    </div> : <>
      {(error || emailAlreadyLinked) && <div ref={errorRef} className="cb-alert signup-error" role="alert" tabIndex={-1}>
        <p>{emailAlreadyLinked ? t('auth.registrationEmailLinked') : error}</p>
        {emailAlreadyLinked && <Link to="/login">{t('auth.registrationExistingSignIn')}</Link>}
      </div>}
      <form onSubmit={handleSubmit} noValidate><fieldset className="cb-details-fields" disabled={isLoading}>
        <div className="ca-field"><label className="cb-field-label" htmlFor="name">{t('common.fullName')}</label><input className="cb-input" id="name" name="name" value={formData.name} onChange={handleChange} autoComplete="name" minLength={2} maxLength={120} required /></div>
        <div className="ca-field"><label className="cb-field-label" htmlFor="email">{t('common.email')}</label><input className="cb-input" id="email" name="email" type="email" dir="ltr" value={formData.email} onChange={handleChange} autoComplete="email" maxLength={254} required /></div>
        <div className="ca-field"><label className="cb-field-label" htmlFor="phone">{t('auth.phoneNumber')}</label><div className="signup-phone-wrapper">
          <select className="cb-input signup-country-select" name="countryCode" aria-label={t('managerOnboarding.countryCode')} value={formData.countryCode} onChange={handleChange}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.flag} {country.label}</option>)}</select>
          <input className="cb-input signup-phone-input" id="phone" name="phone" type="tel" dir="ltr" value={formData.phone} onChange={handleChange} autoComplete="tel-national" inputMode="tel" maxLength={20} required />
        </div></div>
        {passwordField('password', t('auth.password'), showPassword, setShowPassword)}
        {passwordField('confirmPassword', t('auth.confirmPassword'), showConfirmPassword, setShowConfirmPassword)}
        <p className="cb-helper ca-password-hint">{t('customerAuth.passwordRules')}</p>
        <button type="submit" className="cb-primary ca-submit" disabled={isLoading}>{isLoading && <Loader2 size={18} className="cb-spinner" aria-hidden="true" />}{t(isLoading ? 'auth.creatingAccount' : 'auth.createAccount')}</button>
      </fieldset></form>
    </>}
    {!registration && <p className="ca-switch">{t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link></p>}
  </CustomerAuthLayout>;
}
