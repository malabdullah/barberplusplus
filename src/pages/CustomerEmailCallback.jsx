import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, Link2Off } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { forgetEmail } from '../lib/customerEmailFlow';
import { forgetRegistration } from '../lib/pendingRegistration';
import { nativeEmailReturn } from '../lib/nativeEmailReturn';
import { appConfig } from '../lib/runtimeConfig';

export default function CustomerEmailCallback() {
  const { t } = useTranslation(); const tr = key => t(`customerAuth.${key}`);
  const { refresh } = useCustomerAuth(); const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); const [returnTo, setReturnTo] = useState('/customer/account');
  const callback = useRef(null);
  const originalUrl = useRef(window.location.href);
  const [native, setNative] = useState(() => {
    const requested = new URL(window.location.href).searchParams.get('client') === 'ios';
    try { return { requested, url: nativeEmailReturn(window.location.href, appConfig) }; } catch (error) { return { requested, url: null, recovery: error.message === 'NATIVE_DELIVERY_REQUIRED' }; }
  });
  useEffect(() => {
    let active = true;
    if (native.requested) {
      window.history.replaceState(null, '', window.location.pathname);
      if (native.recovery) {
        callback.current ||= customerAuthService.nativeRecoveryDelivery(originalUrl.current);
        callback.current.then(url => { if (active) { setNative(current => ({ ...current, url })); setStatus('native'); } }).catch(() => { if (active) setStatus('error'); });
      } else setStatus(native.url ? 'native' : 'error');
      return () => { active = false; };
    }
    const run = async () => {
      try {
        callback.current ||= customerAuthService.finishEmail(originalUrl.current);
        const result = await callback.current;
        if (!active) return;
        forgetEmail(); setReturnTo(result.returnTo);
        if (result.recovery) { navigate(result.legacyRecovery ? '/reset-password' : '/customer/reset-password', { replace: true, state: { recovery: true, returnTo: result.returnTo } }); return; }
        if (new URL(originalUrl.current).searchParams.get('next') === 'work') { forgetRegistration(); setStatus('work-verified'); return; }
        const profile = await customerAuthService.ensureEmailProfile();
        if (!active) return;
        if (profile.needsName) { navigate('/customer/complete-profile', { replace: true, state: { returnTo: result.returnTo } }); return; }
        await refresh(); if (active) setStatus('verified');
      } catch { if (active) setStatus('error'); }
    };
    run(); return () => { active = false; };
  }, []);
  if (status === 'native') return <CustomerAuthLayout title={t('customerPassword.openAppTitle')} intro={t('customerPassword.openAppIntro')}><a className="cb-primary ca-submit" href={native.url}>{t('customerPassword.openApp')}</a></CustomerAuthLayout>;
  if (status === 'work-verified') return <CustomerAuthLayout accountType="team" title={t('auth.registrationVerifiedTitle')} intro={t('auth.registrationVerified')}><Link className="cb-primary ca-submit" to="/login">{t('auth.signIn')}</Link></CustomerAuthLayout>;
  return <CustomerAuthLayout title={tr(status === 'verified' ? 'email.verifiedTitle' : status === 'error' ? 'email.invalidLinkTitle' : 'email.callbackTitle')} intro={status === 'verified' ? tr('email.verifiedIntro') : undefined} returnTo={returnTo}>
    <div className="ca-result">
      {status === 'error' ? <><Link2Off className="ca-state-icon" size={36} aria-hidden="true" /><p className="cb-alert" role="alert">{tr('email.invalidLink')}</p><Link className="cb-primary ca-submit" to="/customer/verify-email">{tr('email.requestConfirmation')}</Link><Link className="cb-text-button" to="/customer/forgot-password">{tr('forgotPassword')}</Link></> : status === 'verified' ? <><ShieldCheck className="ca-state-icon" size={36} aria-hidden="true" /><p role="status">{tr('email.verifiedStatus')}</p><Link className="cb-primary ca-submit" to={returnTo} replace>{tr(returnTo === '/book' ? 'resumeBooking' : 'myAccount')}</Link></> : <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={24} aria-hidden="true" />{tr('loading')}</p>}
    </div>
  </CustomerAuthLayout>;
}
