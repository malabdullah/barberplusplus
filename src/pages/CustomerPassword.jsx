import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { customerAuthService } from '../services/customerAuth.service';
import { passwordProof } from '../lib/customerPasswordProof';
import { rememberEmail } from '../lib/customerEmailFlow';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';

export default function CustomerPassword({ mode = 'account', audience = 'customer', backTo }) {
  const { t } = useTranslation(); const tr = key => t(`customerPassword.${key}`);
  const navigate = useNavigate(); const bootstrap = useRef(null);
  const [capability, setCapability] = useState(null); const [proof, setProof] = useState(() => mode === 'reset' ? passwordProof() : null);
  const [loading, setLoading] = useState(mode !== 'reset'); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [done, setDone] = useState(false); const [show, setShow] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  usePublicNavigationBusy(busy);
  useEffect(() => {
    let active = true;
    if (mode === 'reset') return undefined;
    const load = async () => {
      try {
        if (mode === 'invite') {
          const url = new URL(window.location.href); const hash = new URLSearchParams(url.hash.slice(1));
          window.history.replaceState(null, '', url.pathname);
          bootstrap.current ||= customerAuthService.verifyInvite(hash.get('token_hash'));
          await bootstrap.current; if (active) setProof(passwordProof());
        } else {
          const result = await customerAuthService.passwordStatus(); if (active) setCapability(result);
        }
      } catch (failure) { if (active) setError(mode === 'invite' ? 'INVALID_INVITE' : failure.message); }
      finally { if (active) setLoading(false); }
    };
    load(); return () => { active = false; };
  }, [mode]);
  const change = mode === 'account' && capability?.hasPassword;
  const setup = mode === 'account' && capability && !capability.hasPassword;
  const hasProof = mode === 'account' || Boolean(proof);
  const signInPath = proof?.signInPath || (audience === 'work' || mode === 'invite' ? '/login' : '/customer/sign-in');
  const title = done ? tr('successTitle') : mode === 'reset' ? tr('resetTitle') : change ? tr('changeTitle') : mode === 'invite' ? tr('inviteTitle') : tr('title');
  const sendSetup = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await customerAuthService.setupPassword({ audience });
      const pending = { email: result.email, purpose: 'recovery', audience, requestId: result.requestId, setup: true, sentAt: Date.now() };
      rememberEmail(pending); navigate('/customer/verify-email?purpose=recovery', { state: pending });
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      if (change) await customerAuthService.changePassword(form);
      else await customerAuthService.resetPassword(form);
      setForm({ currentPassword: '', password: '', confirmPassword: '' }); setDone(true);
    } catch (failure) { setError(failure.message); if (failure.message === 'PASSWORD_UPDATE_UNCERTAIN') setForm({ currentPassword: '', password: '', confirmPassword: '' }); }
    finally { setBusy(false); }
  };
  const field = (name, label, autocomplete) => <div className="ca-field" key={name}>
    <label className="cb-field-label" htmlFor={name}>{label}</label><div className="ca-password">
      <input id={name} className="cb-input" type={show ? 'text' : 'password'} autoComplete={autocomplete} maxLength={72} required value={form[name]} onChange={event => { setForm(current => ({ ...current, [name]: event.target.value })); setError(''); }} />
      <button type="button" onClick={() => setShow(value => !value)} aria-label={`${t(`customerAuth.${show ? 'hidePassword' : 'showPassword'}`)} ${label}`}>{show ? <EyeOff size={19} /> : <Eye size={19} />}</button>
    </div>
  </div>;
  const errorText = key => t(`customerPassword.errors.${key}`, { defaultValue: tr('errors.UNAVAILABLE') });
  return <CustomerAuthLayout title={title} intro={done ? undefined : mode === 'invite' ? tr('inviteIntro') : mode === 'reset' ? tr('resetIntro') : change ? tr('changeIntro') : tr('intro')} accountType={audience === 'work' || mode === 'invite' ? 'team' : 'customer'} backTo={backTo || (mode === 'account' ? '/customer/account' : signInPath)} backLabel={backTo ? t('common.back') : mode === 'account' ? t('customerAuth.myAccount') : t('customerAuth.backToSignIn')}>
    {loading ? <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={24} />{t('customerAuth.loading')}</p> : done ? <div className="ca-result"><ShieldCheck className="ca-state-icon" size={36} aria-hidden="true" /><p role="status">{tr('success')}</p><Link className="cb-primary ca-submit" to={signInPath}>{t('customerAuth.signIn')}</Link></div> : <>
      {error && <p className="cb-alert" role="alert">{errorText(error)}</p>}
      {!hasProof && <p className="cb-helper">{tr(mode === 'invite' ? 'inviteExpired' : 'verifyFirst')}</p>}
      {setup ? <>
        <p className="cb-helper">{tr('providerOnly')}</p>
        {capability.canVerifyEmail ? <><p className="ca-email-summary" dir="ltr">{capability.email}</p><p className="cb-helper">{tr('setupIntro')}</p><button className="cb-primary ca-submit" type="button" onClick={sendSetup} disabled={busy}>{busy && <Loader2 className="cb-spinner" size={18} />}{tr('sendCode')}</button></> : <p className="cb-alert">{tr('emailRequired')}</p>}
      </> : hasProof && (change || mode !== 'account') && error !== 'PASSWORD_UPDATE_UNCERTAIN' ? <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={busy}>
        {change && field('currentPassword', tr('currentPassword'), 'current-password')}
        {field('password', t('customerAuth.newPassword'), 'new-password')}
        {field('confirmPassword', t('customerAuth.confirmPassword'), 'new-password')}
        <p className="cb-helper ca-password-hint">{t('customerAuth.passwordRules')}</p>
        <p className="cb-helper">{tr('sessionNotice')}</p>
        <button className="cb-primary ca-submit" type="submit" disabled={busy}>{busy && <Loader2 className="cb-spinner" size={18} />}{tr(change ? 'saveChange' : 'savePassword')}</button>
      </fieldset></form> : null}
      {(mode === 'reset' || change || error === 'PASSWORD_UPDATE_UNCERTAIN') && <Link className="cb-text-button" to="/customer/forgot-password">{t('customerAuth.forgotPassword')}</Link>}
      {change && capability?.providers?.some(provider => ['google', 'apple'].includes(provider)) && <p className="cb-helper">{tr('providersPreserved')}</p>}
      {error === 'AUTH_REQUIRED' && <Link className="cb-primary ca-submit" to={signInPath}>{t('customerAuth.signIn')}</Link>}
    </>}
  </CustomerAuthLayout>;
}
