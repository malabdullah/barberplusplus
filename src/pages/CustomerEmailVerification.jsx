import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Mail, ShieldCheck } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import { customerAuthService } from '../services/customerAuth.service';
import { emailDestination, pendingEmail, rememberEmail, forgetEmail } from '../lib/customerEmailFlow';

export default function CustomerEmailVerification() {
  const { t } = useTranslation();
  const tr = key => t(`customerAuth.${key}`);
  const location = useLocation(); const navigate = useNavigate(); const { refresh } = useCustomerAuth();
  const purpose = new URLSearchParams(location.search).get('purpose') === 'recovery' ? 'recovery' : 'signup';
  const [pending] = useState(() => { const value = location.state || pendingEmail(); return value?.purpose === purpose ? value : null; });
  const returnTo = emailDestination(pending?.returnTo);
  const [email, setEmail] = useState(pending?.email || '');
  const [editing, setEditing] = useState(!pending?.email);
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [verified, setVerified] = useState(false);
  const [retryAt, setRetryAt] = useState(pending?.sentAt ? pending.sentAt + 60000 : 0);
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  usePublicNavigationBusy(busy);
  useEffect(() => { if (!remaining) return undefined; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [remaining]);
  const validEmail = () => email.trim().length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim());
  const resend = async () => {
    if (busy || remaining) return;
    if (!validEmail()) { setError('INVALID_DETAILS'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      if (purpose === 'recovery') await customerAuthService.requestRecovery({ email, returnTo });
      else await customerAuthService.resendConfirmation({ email, returnTo });
      rememberEmail({ email, purpose, returnTo }); setRetryAt(Date.now() + 60000); setNow(Date.now());
      setEditing(false); setCode(''); setNotice(tr('email.resent'));
    } catch (failure) { setError(failure.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'UNAVAILABLE'); }
    finally { setBusy(false); }
  };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    if (!validEmail()) { setError('INVALID_DETAILS'); return; }
    if (!/^\d{6,10}$/.test(code)) { setError('INVALID_CODE'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await customerAuthService.verifyEmailCode({ email, code, purpose });
      forgetEmail();
      if (purpose === 'recovery') { navigate('/customer/reset-password', { replace: true, state: { recovery: true, returnTo } }); return; }
      const profile = await customerAuthService.ensureEmailProfile();
      if (profile.needsName) { navigate('/customer/complete-profile', { replace: true, state: { returnTo } }); return; }
      await refresh(); setVerified(true); setCode('');
    } catch (failure) { setError(['INVALID_CODE', 'RATE_LIMITED'].includes(failure.message) ? failure.message : 'UNAVAILABLE'); }
    finally { setBusy(false); }
  };
  const title = tr(verified ? 'email.verifiedTitle' : purpose === 'recovery' ? 'email.recoveryTitle' : 'email.verifyTitle');
  return <CustomerAuthLayout title={title} intro={tr(verified ? 'email.verifiedIntro' : 'email.verifyIntro')} returnTo={returnTo}>
    {verified ? <div className="ca-result"><ShieldCheck className="ca-state-icon" size={36} aria-hidden="true" /><p role="status">{tr('email.verifiedStatus')}</p><Link className="cb-primary ca-submit" to={returnTo} replace>{tr(returnTo === '/book' ? 'bookNow' : 'myAccount')}</Link></div> : <>
      <div className="ca-email-summary" role="status"><Mail size={20} aria-hidden="true" /><p>{tr(purpose === 'recovery' ? 'email.recoverySent' : 'email.signupSent')}{!editing && <strong dir="ltr">{email}</strong>}</p></div>
      {error && <p className="cb-alert" role="alert" id="email-code-error">{tr(`errors.${error}`)}</p>}
      {notice && <p className="ca-notice" role="status">{notice}</p>}
      <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={busy}>
        {editing && <><label className="cb-field-label" htmlFor="verification-email">{tr('email.label')}</label><input className="cb-input" id="verification-email" type="email" autoComplete="email" dir="ltr" value={email} onChange={event => { setEmail(event.target.value); setError(''); }} maxLength={254} required /></>}
        <label className="cb-field-label" htmlFor="email-code">{tr('email.codeLabel')}</label>
        <input className="cb-input ca-code" id="email-code" type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={10} value={code} aria-invalid={error === 'INVALID_CODE'} aria-describedby={error ? 'email-code-error email-code-hint' : 'email-code-hint'} onChange={event => { setCode(event.target.value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit >= '۰' ? 1776 : 1632))).replace(/\D/g, '')); setError(''); }} required />
        <p className="cb-helper" id="email-code-hint">{tr('email.codeHint')}</p>
        <button type="submit" className="cb-primary ca-submit" disabled={busy}>{busy && <Loader2 className="cb-spinner" size={18} aria-hidden="true" />}{tr('email.verifyCode')}</button>
      </fieldset></form>
      <div className="ca-verification-actions"><button type="button" className="cb-text-button" onClick={resend} disabled={busy || remaining > 0}>{remaining ? t('customerAuth.email.resendIn', { seconds: remaining }) : tr('email.resendCode')}</button>{!editing && <button className="cb-text-button" type="button" disabled={busy} onClick={() => { setEditing(true); setCode(''); setError(''); }}>{tr('email.changeAddress')}</button>}</div>
      <p className="cb-helper ca-email-hint">{tr('email.linkAlternative')}</p>
    </>}
  </CustomerAuthLayout>;
}
