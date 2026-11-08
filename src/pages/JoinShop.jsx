import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import CustomerSocialButtons from '../components/Customer/CustomerSocialButtons';
import { customerAuthService } from '../services/customerAuth.service';
import { barberInvitationsService as api } from '../services/barberInvitations.service';
import { supabase } from '../lib/supabase';
import { appConfig } from '../lib/runtimeConfig';
import { GCC_COUNTRIES } from '../constants/countries';
import { readShopInvitation, rememberShopInvitation, clearShopInvitation } from '../lib/shopInvitation';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import '../components/Invitations/Invitations.css';
import './Signup.css';
const social = {
  socialProviders: customerAuthService.socialProviders,
  startSocial: async provider => {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: appConfig.appUrl + '/accept-invite' } });
    if (error) throw error;
  },
};
export default function JoinShop() {
  const { t } = useTranslation(); const tr = key => t('barberInvitations.' + key);
  const [invite] = useState(readShopInvitation); const [details, setDetails] = useState(null);
  const [session, setSession] = useState(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [show, setShow] = useState(false); const pending = useRef(false); const oauth = useRef(null);
  const draftKey = 'barber-invitation-draft:' + invite?.id;
  const [form, setForm] = useState(() => {
    let saved; try { saved = JSON.parse(sessionStorage.getItem(draftKey)); } catch { /* Optional storage. */ }
    return { name: String(saved?.name || '').slice(0, 120), phone: String(saved?.phone || '').slice(0, 20), countryCode: saved?.countryCode || '+965', password: '', confirmPassword: '' };
  });
  usePublicNavigationBusy(busy);
  useEffect(() => {
    if (!invite) { setError('INVITE_INVALID'); setLoading(false); return undefined; }
    rememberShopInvitation(invite);
    let active = true;
    const load = async () => {
      try {
        const url = new URL(window.location.href); const code = url.searchParams.get('code');
        if (url.searchParams.has('error')) throw new Error('SOCIAL_FAILED');
        if (code) {
          oauth.current ||= supabase.auth.exchangeCodeForSession(code);
          const result = await oauth.current; if (result.error) throw new Error('SOCIAL_FAILED');
          window.history.replaceState(null, '', '/accept-invite?invitation=' + invite.id + '#token=' + invite.token);
        }
        const { data } = await supabase.auth.getSession(); const result = await api.resolve(invite);
        if (!active) return;
        setSession(data.session); setDetails(result);
        setForm(old => ({ ...old, name: result.name || old.name, phone: result.phone || old.phone, countryCode: result.country_code || old.countryCode }));
      } catch (e) { if (active) setError(e.message); } finally { if (active) setLoading(false); }
    };
    load(); return () => { active = false; };
  }, [invite]);
  const update = e => {
    setForm(old => {
      const next = { ...old, [e.target.name]: e.target.value };
      try { sessionStorage.setItem(draftKey, JSON.stringify({ name: next.name, phone: next.phone, countryCode: next.countryCode })); } catch { /* Optional storage. */ }
      return next;
    }); setError('');
  };
  const wrongSession = session && details && session.user.email?.toLowerCase() !== details.email;
  const signIn = async e => {
    e.preventDefault(); if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.auth.signInWithPassword({ email: details.email, password: form.password });
      if (result.error) throw new Error(result.error.code === 'email_not_confirmed' ? 'EMAIL_UNVERIFIED' : 'INVALID_LOGIN');
      const value = await api.resolve(invite); setDetails(value); setSession(result.data.session); setForm(old => ({ ...old, password: '', name: value.name || old.name, phone: value.phone || old.phone, countryCode: value.country_code || old.countryCode }));
    } catch (e2) { setError(e2.message); } finally { pending.current = false; setBusy(false); }
  };
  const accept = async e => {
    e.preventDefault(); if (pending.current) return;
    if (details.kind === 'new' && form.password !== form.confirmPassword) { setError('PASSWORD_MISMATCH'); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      await api.accept(invite, form);
      clearShopInvitation(); try { sessionStorage.removeItem(draftKey); } catch { /* Optional storage. */ }
      if (details.kind === 'new') {
        const result = await supabase.auth.signInWithPassword({ email: details.email, password: form.password });
        if (result.error) { window.location.replace('/login'); return; }
      } else {
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error) { window.location.replace('/login'); return; }
      }
      window.location.replace('/barber/availability');
    } catch (e2) { setError(e2.message); pending.current = false; setBusy(false); }
  };
  const passwordField = (key, label) => <div className="ca-field"><label className="cb-field-label" htmlFor={'join-' + key}>{label}</label><div className="ca-password"><input id={'join-' + key} className="cb-input" type={show ? 'text' : 'password'} name={key} autoComplete={details?.kind === 'new' ? 'new-password' : 'current-password'} value={form[key]} onChange={update} required /><button type="button" aria-label={t('customerAuth.' + (show ? 'hidePassword' : 'showPassword'))} onClick={() => setShow(x => !x)}>{show ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>;
  const fatal = !details && !loading;
  return <CustomerAuthLayout accountType="team" title={tr('join')} intro={details?.shop} backTo="/login" backLabel={t('auth.backToLogin')}>
    {loading && <p role="status"><Loader2 size={20} className="cb-spinner" />{t('common.loading')}</p>}
    {error && <p role="alert" className="cb-alert">{tr('errors.' + error)}</p>}
    {fatal && <Link className="cb-primary" to="/login">{t('auth.signIn')}</Link>}
    {details && <>
      <p className="invitation-email" dir="ltr">{details.email}</p>
      {wrongSession ? <div className="invitation-result"><p>{tr('wrongAccount')}</p><button className="cb-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await supabase.auth.signOut({ scope: 'local' }); setSession(null); setDetails(await api.resolve(invite)); } catch (e) { setError('UNAVAILABLE'); } finally { setBusy(false); } }}>{tr('switchAccount')}</button></div>
      : details.kind === 'customer' && !details.signed_in ? <>
        <p>{tr('existingSignIn')}</p><CustomerSocialButtons authService={social} disabled={busy} />
        <form onSubmit={signIn}><fieldset className="cb-details-fields" disabled={busy}>{passwordField('password', t('auth.password'))}<button type="submit" className="cb-primary ca-submit" disabled={busy}>{t('auth.signIn')}</button></fieldset></form>
      </> : <form onSubmit={accept}><fieldset className="cb-details-fields" disabled={busy}>
        <div className="ca-field"><label className="cb-field-label" htmlFor="join-name">{t('common.fullName')}</label><input id="join-name" className="cb-input" name="name" value={form.name} onChange={update} autoComplete="name" minLength={2} maxLength={120} readOnly={Boolean(details.name)} required /></div>
        <div className="ca-field"><label className="cb-field-label" htmlFor="join-phone">{t('auth.phoneNumber')}</label><div className="signup-phone-wrapper"><select className="cb-input signup-country-select" aria-label={t('managerOnboarding.countryCode')} name="countryCode" value={form.countryCode} onChange={update} disabled={Boolean(details.phone)}>{GCC_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}</select><input id="join-phone" className="cb-input signup-phone-input" type="tel" dir="ltr" name="phone" autoComplete="tel-national" value={form.phone} onChange={update} maxLength={20} readOnly={Boolean(details.phone)} required /></div></div>
        {details.kind === 'new' && <>{passwordField('password', t('auth.password'))}{passwordField('confirmPassword', t('auth.confirmPassword'))}<p className="cb-helper ca-password-hint">{t('customerAuth.passwordRules')}</p></>}
        <button type="submit" className="cb-primary ca-submit" disabled={busy}>{tr(busy ? 'joining' : 'accept')}</button>
      </fieldset></form>}
    </>}
  </CustomerAuthLayout>;
}
