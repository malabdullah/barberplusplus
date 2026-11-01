import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import CustomerSocialButtons from '../components/Customer/CustomerSocialButtons';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { rememberEmail } from '../lib/customerEmailFlow';
import { validatePassword } from '../utils/validation';

export default function CustomerAuth({ mode }) {
  const { t } = useTranslation();
  const tr = key => t(`customerAuth.${key}`);
  const { customer, loading, login, resetPassword } = useCustomerAuth();
  const navigate = useNavigate(); const location = useLocation();
  const returnTo = location.state?.returnTo === '/book' ? '/book' : '/customer/account';
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false); const [resetDone, setResetDone] = useState(false);
  usePublicNavigationBusy(busy);
  const signup = mode === 'sign-up'; const recovery = mode === 'forgot-password'; const reset = mode === 'reset-password';
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); setError(''); };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    if (!reset && (form.email.trim().length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(form.email.trim()))) { setError('INVALID_DETAILS'); return; }
    if (signup && (form.name.trim().length < 2 || form.name.trim().length > 120)) { setError('INVALID_DETAILS'); return; }
    if (signup || reset) {
      if (!validatePassword(form.password, { minLength: 8 }).valid || new TextEncoder().encode(form.password).length > 72) { setError('WEAK_PASSWORD'); return; }
      if (form.password !== form.confirmPassword) { setError('PASSWORD_MISMATCH'); return; }
    }
    setBusy(true); setError('');
    try {
      if (mode === 'sign-in') { await login(form); navigate(returnTo, { replace: true }); }
      else if (signup || recovery) {
        if (signup) await customerAuthService.requestSignup({ ...form, returnTo });
        else await customerAuthService.requestRecovery({ ...form, returnTo });
        const pending = { email: form.email.trim().toLowerCase(), purpose: signup ? 'signup' : 'recovery', returnTo, sentAt: Date.now() };
        rememberEmail(pending); setForm(current => ({ ...current, password: '', confirmPassword: '' }));
        navigate(`/customer/verify-email?purpose=${pending.purpose}`, { state: pending });
      } else if (reset && location.state?.recovery) {
        await resetPassword({ password: form.password }); setForm(current => ({ ...current, password: '', confirmPassword: '' })); setResetDone(true);
      }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const passwordField = (key, label) => <div className="ca-field"><label className="cb-field-label" htmlFor={key}>{label}</label><div className="ca-password"><input className="cb-input" id={key} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={form[key]} onChange={event => update(key, event.target.value)} maxLength={72} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={tr(showPassword ? 'hidePassword' : 'showPassword')}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>;
  const errors = ['INVALID_DETAILS', 'WEAK_PASSWORD', 'PASSWORD_MISMATCH', 'INVALID_LOGIN', 'ACCOUNT_UNAVAILABLE', 'RATE_LIMITED', 'AUTH_REQUIRED', 'SIGN_IN_REQUIRED'];
  if (!loading && customer && !reset && !recovery) return <Navigate to={returnTo} replace />;
  return <CustomerAuthLayout title={tr(resetDone ? 'email.passwordUpdatedTitle' : `titles.${mode}`)} intro={resetDone ? undefined : tr(`email.intros.${mode}`)} returnTo={returnTo} backToBooking={mode === 'sign-in'}>
    {(mode === 'sign-in' || signup) && <CustomerSocialButtons returnTo={returnTo} disabled={busy || loading} />}
    {error && <p className="cb-alert" role="alert">{tr(`errors.${errors.includes(error) ? error : 'UNAVAILABLE'}`)}</p>}
    {resetDone ? <div className="ca-result"><ShieldCheck className="ca-state-icon" size={36} aria-hidden="true" /><p role="status">{tr('resetSuccess')}</p><Link className="cb-primary ca-submit" to="/customer/sign-in" state={{ returnTo }}>{tr('signIn')}</Link></div> : reset && !location.state?.recovery ? <div className="ca-result"><p className="cb-alert" role="alert">{tr('email.invalidLink')}</p><Link className="cb-primary ca-submit" to="/customer/forgot-password" state={{ returnTo }}>{tr('email.requestNewLink')}</Link></div> : <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={busy || loading}>
      {signup && <div className="ca-field"><label className="cb-field-label" htmlFor="customer-auth-name">{tr('name')}</label><input className="cb-input" id="customer-auth-name" autoComplete="name" value={form.name} maxLength={120} onChange={event => update('name', event.target.value)} required /></div>}
      {!reset && <div className="ca-field"><label className="cb-field-label" htmlFor="customer-auth-email">{tr('email.label')}</label><input className="cb-input" id="customer-auth-email" type="email" dir="ltr" autoComplete="email" value={form.email} maxLength={254} onChange={event => update('email', event.target.value)} required /></div>}
      {(mode === 'sign-in' || signup || reset) && <>{passwordField('password', tr(reset ? 'newPassword' : 'password'))}{(signup || reset) && <>{passwordField('confirmPassword', tr('confirmPassword'))}<p className="cb-helper ca-password-hint">{tr('passwordRules')}</p></>}</>}
      {mode === 'sign-in' && <Link className="cb-text-button ca-forgot" to="/customer/forgot-password" state={{ returnTo }}>{tr('forgotPassword')}</Link>}
      <button type="submit" className="cb-primary ca-submit" disabled={busy || loading}>{busy && <Loader2 size={18} className="cb-spinner" aria-hidden="true" />}{tr(mode === 'sign-in' ? 'signIn' : signup ? 'createAccount' : recovery ? 'email.sendRecovery' : 'resetPassword')}</button>
    </fieldset></form>}
    {mode === 'sign-in' && <p className="ca-switch">{tr('noAccount')} <Link to="/customer/sign-up" state={{ returnTo }}>{tr('createAccount')}</Link></p>}
    {signup && <p className="ca-switch">{tr('hasAccount')} <Link to="/customer/sign-in" state={{ returnTo }}>{tr('signIn')}</Link></p>}
  </CustomerAuthLayout>;
}
