import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import CustomerHeader from '../components/Customer/CustomerHeader';
import { GCC_COUNTRIES } from '../constants/countries';
import { validatePhoneNumber, validatePassword } from '../utils/validation';
import './CustomerBooking.css';
import './CustomerAuth.css';

export default function CustomerAuth({ mode }) {
  const { t, i18n } = useTranslation();
  const tr = (key, values) => t(`customerAuth.${key}`, values);
  const { customer, loading, login, signup, resetPassword } = useCustomerAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo === '/book' ? '/book' : '/customer/account';
  const [form, setForm] = useState({ name: '', countryCode: '+965', phone: '', email: '', password: '', confirmPassword: '', code: '' });
  const [challenge, setChallenge] = useState(mode === 'reset-password' ? location.state?.challenge || null : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const codeRef = useRef(null);
  const signupMode = mode === 'sign-up';
  const recoveryMode = mode === 'forgot-password';
  const resetMode = mode === 'reset-password';
  const [resetDone, setResetDone] = useState(false);
  useEffect(() => { document.title = `${tr(`titles.${mode}`)} | Barber++`; }, [mode, t]);
  useEffect(() => { if (challenge && !resetDone) codeRef.current?.focus(); }, [challenge, resetDone]);
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); setError(''); };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    if (!resetMode && !challenge && !validatePhoneNumber(form.phone.replace(/[\s()-]/g, ''), form.countryCode).valid) { setError('INVALID_PHONE'); return; }
    if (signupMode && (form.name.trim().length < 2 || form.name.trim().length > 120 || form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))) { setError('INVALID_DETAILS'); return; }
    if (signupMode || resetMode) {
      if (!validatePassword(form.password).valid || new TextEncoder().encode(form.password).length > 72) { setError('WEAK_PASSWORD'); return; }
      if (form.password !== form.confirmPassword) { setError('PASSWORD_MISMATCH'); return; }
    }
    setBusy(true); setError('');
    try {
      if (mode === 'sign-in') { await login(form); navigate(returnTo, { replace: true }); }
      else if (signupMode && !challenge) setChallenge(await customerAuthService.requestSignup(form));
      else if (signupMode) { await signup({ challenge: challenge.challenge, code: form.code, password: form.password }); navigate(returnTo, { replace: true }); }
      else if (recoveryMode) {
        const result = await customerAuthService.requestRecovery(form);
        navigate('/customer/reset-password', { replace: true, state: { returnTo, challenge: result } });
      } else if (resetMode && challenge) {
        await resetPassword({ challenge: challenge.challenge, code: form.code, password: form.password });
        setForm(current => ({ ...current, password: '', confirmPassword: '', code: '' })); setResetDone(true);
      }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const passwordField = (key, label) => <>
    <label className="cb-field-label" htmlFor={key}>{label}</label>
    <div className="ca-password"><input className="cb-input" id={key} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={form[key]} onChange={event => update(key, event.target.value)} maxLength={72} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={tr(showPassword ? 'hidePassword' : 'showPassword')}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
  </>;
  const verification = challenge && <>
    <div className="cb-test-code"><ShieldCheck size={20} aria-hidden="true" /><div><strong>{t('customerBooking.testCode', { code: challenge.testCode })}</strong><p>{t('customerBooking.noSms')}</p></div></div>
    <label className="cb-field-label" htmlFor="customer-auth-code">{t('customerBooking.verificationCode')}</label><input ref={codeRef} id="customer-auth-code" className="cb-input cb-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={form.code} onChange={event => update('code', event.target.value.replace(/\D/g, ''))} required />
    <p className="cb-helper">{t('customerBooking.codeExpires')}</p>
  </>;
  const errors = ['INVALID_PHONE','INVALID_DETAILS','WEAK_PASSWORD','PASSWORD_MISMATCH','INVALID_CODE','INVALID_LOGIN','ACCOUNT_UNAVAILABLE','RATE_LIMITED','AUTH_REQUIRED','SIGN_IN_REQUIRED'];
  if (!loading && customer && !resetMode && !recoveryMode) return <Navigate to={returnTo} replace />;
  return <div className="customer-booking ca-page" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>
    <CustomerHeader busy={busy} />
    <main className="ca-main">
      <Link className="cb-text-button" to="/book">{tr('backToBooking')}</Link>
      <h1>{tr(`titles.${mode}`)}</h1><p className="cb-intro">{tr(`intros.${mode}`)}</p>
      {error && <p className="cb-alert" role="alert">{tr(`errors.${errors.includes(error) ? error : 'UNAVAILABLE'}`)}</p>}
      {resetDone ? <div role="status"><ShieldCheck size={32} /><p>{tr('resetSuccess')}</p><Link className="cb-primary" to="/customer/sign-in" state={{ returnTo }}>{tr('signIn')}</Link></div> : resetMode && !challenge ? <p>{tr('expiredRecovery')} <Link to="/customer/forgot-password">{tr('forgotPassword')}</Link></p> : <form onSubmit={submit} noValidate>
        <fieldset className="cb-details-fields" disabled={busy || loading}>
          {signupMode && !challenge && <><label className="cb-field-label" htmlFor="customer-auth-name">{tr('name')}</label><input className="cb-input" id="customer-auth-name" autoComplete="name" value={form.name} maxLength={120} onChange={event => update('name', event.target.value)} required /></>}
          {!resetMode && !challenge && <>
            <label className="cb-field-label" htmlFor="customer-auth-phone">{tr('phone')}</label><div className="cb-phone-input" dir="ltr"><select aria-label={tr('countryCode')} value={form.countryCode} onChange={event => update('countryCode', event.target.value)}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.code}</option>)}</select><input id="customer-auth-phone" type="tel" autoComplete="tel-national" value={form.phone} maxLength={14} onChange={event => update('phone', event.target.value.replace(/[^0-9\s()-]/g, ''))} required /></div>
          </>}
          {signupMode && !challenge && <><label className="cb-field-label" htmlFor="customer-auth-email">{tr('emailOptional')}</label><input className="cb-input" id="customer-auth-email" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={event => update('email', event.target.value)} /><p className="cb-helper">{tr('emailHint')}</p></>}
          {resetMode && verification}
          {(mode === 'sign-in' || signupMode && !challenge || resetMode) && <>
            {passwordField('password', tr(resetMode ? 'newPassword' : 'password'))}
            {(signupMode || resetMode) && <>{passwordField('confirmPassword', tr('confirmPassword'))}<p className="cb-helper">{tr('passwordRules')}</p></>}
          </>}
          {!resetMode && verification}
          {signupMode && challenge && <button type="button" className="cb-text-button" onClick={() => { setChallenge(null); update('code', ''); }}>{tr('editDetails')}</button>}
          <button type="submit" className="cb-primary ca-submit" disabled={busy || loading || Boolean(challenge && form.code.length !== 6)}>{busy && <Loader2 size={18} className="cb-spinner" />}{tr(mode === 'sign-in' ? 'signIn' : signupMode ? challenge ? 'verifyCreate' : 'createAccount' : recoveryMode ? 'sendRecovery' : 'resetPassword')}</button>
        </fieldset>
      </form>}
      {resetMode && !resetDone && <Link className="cb-text-button" to="/customer/forgot-password" state={{ returnTo }}>{tr('requestNewCode')}</Link>}
      {mode === 'sign-in' && <><Link className="cb-text-button" to="/customer/forgot-password" state={{ returnTo }}>{tr('forgotPassword')}</Link><p>{tr('noAccount')} <Link to="/customer/sign-up" state={{ returnTo }}>{tr('createAccount')}</Link></p></>}
      {signupMode && <p>{tr('hasAccount')} <Link to="/customer/sign-in" state={{ returnTo }}>{tr('signIn')}</Link></p>}
      <Link className="cb-text-button" to="/book">{tr('continueGuest')}</Link>
    </main>
  </div>;
}
