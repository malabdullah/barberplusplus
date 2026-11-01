import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';

export default function CustomerSocialAuth() {
  const { t } = useTranslation(); const tr = key => t(`customerAuth.${key}`);
  const { refresh } = useCustomerAuth(); const location = useLocation(); const navigate = useNavigate();
  const [loading, setLoading] = useState(true); const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [name, setName] = useState('');
  usePublicNavigationBusy(busy);
  const callbackRef = useRef(null); const returnTo = location.state?.returnTo === '/book' ? '/book' : '/customer/account';
  useEffect(() => { document.title = `${tr('social.completeTitle')} | Barber++`; }, [t]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (location.pathname.endsWith('/auth-callback')) {
          callbackRef.current ||= customerAuthService.finishSocial(window.location.href);
          const next = await callbackRef.current;
          if (active) navigate('/customer/complete-profile', { replace: true, state: { returnTo: next } });
          return;
        }
        const result = await customerAuthService.socialStatus();
        if (!active) return;
        const profile = result.profile || await customerAuthService.ensureEmailProfile(result.name || '');
        if (!active) return;
        if (profile.needsName) { setName(result.name || ''); setReady(true); setLoading(false); }
        else { await refresh(); if (active) navigate(returnTo, { replace: true }); }
      } catch { if (active) { setError('SOCIAL_SIGN_IN_FAILED'); setLoading(false); } }
    };
    load(); return () => { active = false; };
  }, [location.pathname, returnTo]);
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    if (name.trim().length < 2 || name.trim().length > 120) { setError('INVALID_DETAILS'); return; }
    setBusy(true); setError('');
    try { await customerAuthService.ensureEmailProfile(name); await refresh(); navigate(returnTo, { replace: true }); }
    catch { setError('SOCIAL_SIGN_IN_FAILED'); }
    finally { setBusy(false); }
  };
  return <CustomerAuthLayout title={tr('social.completeTitle')} intro={tr('email.socialIntro')} returnTo={returnTo}>
    {error && <p className="cb-alert" role="alert">{tr(`errors.${error}`)}</p>}
    {loading ? <p role="status"><Loader2 className="cb-spinner" />{tr('loading')}</p> : ready && <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={busy}>
      <label className="cb-field-label" htmlFor="social-name">{tr('name')}</label><input id="social-name" className="cb-input" autoComplete="name" value={name} maxLength={120} onChange={event => { setName(event.target.value); setError(''); }} required />
      <button className="cb-primary ca-submit" type="submit" disabled={busy}>{busy && <Loader2 className="cb-spinner" size={18} />}{tr('email.continue')}</button>
    </fieldset></form>}
  </CustomerAuthLayout>;
}
