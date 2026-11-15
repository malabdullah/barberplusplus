import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { administratorsService as api } from '../services/administrators.service';
import { supabase } from '../lib/supabase';
function readInvitation() {
  try {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('invitation'), token = new URLSearchParams(url.hash.slice(1)).get('token');
    if (/^[a-f0-9-]{36}$/i.test(id || '') && /^[a-f0-9]{64}$/.test(token || '')) {
      const value = { id, token };
      sessionStorage.setItem('barber-admin-invite', JSON.stringify(value));
      return value;
    }
    return JSON.parse(sessionStorage.getItem('barber-admin-invite')) || null;
  } catch { return null; }
}
export default function AcceptAdminInvitation() {
  const { t } = useTranslation();
  const tr = key => t('administrators.' + key);
  const [invite] = useState(readInvitation), [details, setDetails] = useState(null), [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const flight = useRef(false);
  const errorText = code => tr('errors.' + (['INVITE_INVALID', 'INVITE_USED', 'INVITE_CANCELLED', 'INVITE_EXPIRED', 'INVITE_PROCESSING', 'EMAIL_IN_USE', 'WEAK_PASSWORD'].includes(code) ? code : 'UNAVAILABLE'));
  useEffect(() => {
    let active = true;
    if (!invite) { setError('INVITE_INVALID'); setLoading(false); return; }
    window.history.replaceState(null, '', '/accept-admin-invite?invitation=' + encodeURIComponent(invite.id));
    Promise.all([api.resolve(invite), supabase.auth.getSession()]).then(([data, auth]) => {
      if (active) { setDetails(data); setSession(auth.data.session); }
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [invite]);
  const wrongAccount = session && details && session.user.email?.toLowerCase() !== details.email;
  const accept = async event => {
    event.preventDefault();
    if (flight.current || wrongAccount) return;
    if (password !== confirm) { setError('WEAK_PASSWORD'); return; }
    flight.current = true; setBusy(true); setError('');
    try {
      await api.accept(invite, password);
      sessionStorage.removeItem('barber-admin-invite'); setDone(true);
      const login = await supabase.auth.signInWithPassword({ email: details.email, password });
      if (!login.error) window.location.replace('/mfa-setup?returnTo=%2Fadmin');
      setPassword(''); setConfirm('');
    } catch (failure) { setError(failure.message); }
    finally { flight.current = false; setBusy(false); }
  };
  return <CustomerAuthLayout accountType="team" title={tr('acceptTitle')} intro={details?.name} backTo="/login" backLabel={t('auth.backToLogin')}>
    {loading && <p role="status">{t('common.loading')}</p>}
    {error && <p className="cb-alert" role="alert">{errorText(error)}</p>}
    {done ? <><p role="status">{tr('accountReady')}</p><Link className="cb-primary" to="/login">{t('auth.signIn')}</Link></> : details && <>
      <p dir="ltr">{details.email}</p>
      {wrongAccount ? <><p>{tr('switchAccount')}</p><button className="cb-secondary" type="button" disabled={busy} onClick={async () => { await supabase.auth.signOut({ scope: 'local' }); setSession(null); }}>{t('customerAuth.signOut')}</button></> : <form onSubmit={accept}><fieldset className="cb-details-fields" disabled={busy}>
        <div className="ca-field"><label className="cb-field-label" htmlFor="admin-invite-password">{t('auth.password')}</label><input id="admin-invite-password" className="cb-input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} /></div>
        <div className="ca-field"><label className="cb-field-label" htmlFor="admin-invite-confirm">{t('auth.confirmPassword')}</label><input id="admin-invite-confirm" className="cb-input" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={event => setConfirm(event.target.value)} /></div>
        <p className="cb-helper">{tr('passwordRules')}</p>
        <button className="cb-primary ca-submit" type="submit" disabled={busy}>{tr(busy ? 'creating' : 'accept')}</button>
      </fieldset></form>}
    </>}
  </CustomerAuthLayout>;
}
