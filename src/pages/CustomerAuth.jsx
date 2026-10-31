import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import CustomerSocialButtons from '../components/Customer/CustomerSocialButtons';
import { validatePassword } from '../utils/validation';
import './CustomerBooking.css';
import './CustomerAuth.css';

export default function CustomerAuth({ mode }) {
  const { t, i18n } = useTranslation();
  const tr = key => t(`customerAuth.${key}`);
  const { customer, loading, login, resetPassword } = useCustomerAuth();
  const navigate = useNavigate(); const location = useLocation();
  const returnTo = location.state?.returnTo === '/book' ? '/book' : '/customer/account';
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  usePublicNavigationBusy(busy);
  const [showPassword, setShowPassword] = useState(false); const [sent, setSent] = useState(false);
  const signup = mode === 'sign-up'; const recovery = mode === 'forgot-password'; const reset = mode === 'reset-password';
  const [resetDone, setResetDone] = useState(false);
  useEffect(() => { document.title = `${tr(`titles.${mode}`)} | Barber++`; }, [mode, t]);
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); setError(''); };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    if (!reset && (form.email.trim().length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(form.email.trim()))) { setError('INVALID_DETAILS'); return; }
    if (signup && (form.name.trim().length < 2 || form.name.trim().length > 120)) { setError('INVALID_DETAILS'); return; }
    if (signup || reset) {
      if (!validatePassword(form.password, { minLength: 8 }).valid || new TextEncoder().encode(form.password).length > 72) { setError('WEAK_PASSWORD'); return; }
      if (form.password !== form.confirmPassword) { setError('PASSWORD_MISMATCH'); return; }
    }
    setBusy(true); setError('');
    try {
      if (mode === 'sign-in') { await login(form); navigate(returnTo, { replace: true }); }
      else if (signup) { await customerAuthService.requestSignup({ ...form, returnTo }); setForm(current => ({ ...current, password: '', confirmPassword: '' })); setSent(true); }
      else if (recovery) { await customerAuthService.requestRecovery({ ...form, returnTo }); setSent(true); }
      else if (reset && location.state?.recovery) { await resetPassword({ password: form.password }); setForm(current => ({ ...current, password: '', confirmPassword: '' })); setResetDone(true); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const resend = async () => { setBusy(true); setError(''); try { await customerAuthService.resendConfirmation({ email: form.email, returnTo }); } catch { setError('UNAVAILABLE'); } finally { setBusy(false); } };
  const passwordField = (key, label) => <><label className="cb-field-label" htmlFor={key}>{label}</label><div className="ca-password"><input className="cb-input" id={key} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={form[key]} onChange={event => update(key, event.target.value)} maxLength={72} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={tr(showPassword ? 'hidePassword' : 'showPassword')}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></>;
  const errors = ['INVALID_DETAILS','WEAK_PASSWORD','PASSWORD_MISMATCH','INVALID_LOGIN','ACCOUNT_UNAVAILABLE','RATE_LIMITED','AUTH_REQUIRED','SIGN_IN_REQUIRED'];
  if (!loading && customer && !reset && !recovery) return <Navigate to={returnTo} replace />;
  return <div className="customer-booking ca-page" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}><main className="ca-main">
    <Link className="cb-text-button" to="/book">{tr('backToBooking')}</Link>
    <h1>{tr(`titles.${mode}`)}</h1>{mode !== 'sign-in' && <p className="cb-intro">{tr(`email.intros.${mode}`)}</p>}
    {(mode === 'sign-in' || signup && !sent) && <CustomerSocialButtons returnTo={returnTo} disabled={busy || loading} />}
    {error && <p className="cb-alert" role="alert">{tr(`errors.${errors.includes(error) ? error : 'UNAVAILABLE'}`)}</p>}
    {sent ? <div role="status"><ShieldCheck size={32} /><p>{tr(signup ? 'email.signupSent' : 'email.recoverySent')}</p>{signup && <button type="button" className="cb-text-button" disabled={busy} onClick={resend}>{tr('email.resend')}</button>}</div> : resetDone ? <div role="status"><ShieldCheck size={32} /><p>{tr('resetSuccess')}</p><Link className="cb-primary" to="/customer/sign-in" state={{ returnTo }}>{tr('signIn')}</Link></div> : reset && !location.state?.recovery ? <p>{tr('email.invalidLink')} <Link to="/customer/forgot-password">{tr('forgotPassword')}</Link></p> : <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={busy || loading}>
      {signup && <><label className="cb-field-label" htmlFor="customer-auth-name">{tr('name')}</label><input className="cb-input" id="customer-auth-name" autoComplete="name" value={form.name} maxLength={120} onChange={event => update('name', event.target.value)} required /></>}
      {!reset && <><label className="cb-field-label" htmlFor="customer-auth-email">{tr('email.label')}</label><input className="cb-input" id="customer-auth-email" type="email" autoComplete="email" value={form.email} maxLength={254} onChange={event => update('email', event.target.value)} required /></>}
      {(mode === 'sign-in' || signup || reset) && <>{passwordField('password', tr(reset ? 'newPassword' : 'password'))}{(signup || reset) && <>{passwordField('confirmPassword', tr('confirmPassword'))}<p className="cb-helper">{tr('passwordRules')}</p></>}</>}
      <button type="submit" className="cb-primary ca-submit" disabled={busy || loading}>{busy && <Loader2 size={18} className="cb-spinner" />}{tr(mode === 'sign-in' ? 'signIn' : signup ? 'createAccount' : recovery ? 'email.sendRecovery' : 'resetPassword')}</button>
    </fieldset></form>}
    {mode === 'sign-in' && <><Link className="cb-text-button" to="/customer/forgot-password" state={{ returnTo }}>{tr('forgotPassword')}</Link><p>{tr('noAccount')} <Link to="/customer/sign-up" state={{ returnTo }}>{tr('createAccount')}</Link></p></>}
    {signup && <p>{tr('hasAccount')} <Link to="/customer/sign-in" state={{ returnTo }}>{tr('signIn')}</Link></p>}
    <Link className="cb-text-button" to="/book">{tr('continueGuest')}</Link>
    <p className="ca-privacy-link"><Link to="/privacy">{t('customerPrivacy.title')}</Link></p>
  </main></div>;
}
