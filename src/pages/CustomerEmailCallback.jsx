import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Link2Off } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { confirmSignup } from '../services/signupConfirmation.service';
import { forgetEmail } from '../lib/customerEmailFlow';
import { forgetRegistration } from '../lib/pendingRegistration';
import { nativeEmailReturn } from '../lib/nativeEmailReturn';
import { appConfig } from '../lib/runtimeConfig';

export default function CustomerEmailCallback() {
  const { t } = useTranslation(); const tr = key => t(`customerAuth.${key}`);
  const { refresh } = useCustomerAuth(); const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); const [returnTo, setReturnTo] = useState('/customer/account');
  const callback = useRef(null);
  const nativeAttempted = useRef(false);
  const originalUrl = useRef(window.location.href);
  const [native, setNative] = useState(() => {
    const client = new URL(window.location.href).searchParams.get('client');
    const requested = ['ios', 'android'].includes(client);
    try { return { requested, client, url: nativeEmailReturn(window.location.href, appConfig) }; } catch (error) { return { requested, client, url: null, recovery: error.message === 'NATIVE_DELIVERY_REQUIRED', fallback: error.message === 'ANDROID_NATIVE_FALLBACK' }; }
  });
  useEffect(() => {
    let active = true;
    if (native.requested) {
      window.history.replaceState(null, '', window.location.pathname);
      if (native.fallback) { setStatus('native-fallback'); return () => { active = false; }; }
      if (native.recovery) {
        callback.current ||= customerAuthService.nativeRecoveryDelivery(originalUrl.current);
        callback.current.then(url => { if (active) { setNative(current => ({ ...current, url })); setStatus('native'); } }).catch(() => { if (active) setStatus('error'); });
      } else setStatus(native.url ? 'native' : 'error');
      return () => { active = false; };
    }
    const run = async () => {
      try {
        const signup = new URLSearchParams(new URL(originalUrl.current).hash.slice(1));
        const directSignup = signup.get('type') === 'signup' && signup.has('token_hash');
        if (directSignup) window.history.replaceState(null, '', window.location.pathname);
        callback.current ||= directSignup ? confirmSignup(originalUrl.current) : customerAuthService.finishEmail(originalUrl.current);
        const result = await callback.current;
        if (!active) return;
        forgetEmail(); setReturnTo(result.returnTo);
        if (result.sessionPreserved) { setStatus('session-preserved'); return; }
        if (result.signInRequired) {
          if (result.work) forgetRegistration();
          navigate(result.work ? '/login' : '/customer/sign-in', { replace: true, state: { emailVerified: true, email: result.email, returnTo: result.returnTo } });
          return;
        }
        if (result.recovery) { navigate(result.legacyRecovery ? '/reset-password' : '/customer/reset-password', { replace: true, state: { recovery: true, returnTo: result.returnTo } }); return; }
        if (new URL(originalUrl.current).searchParams.get('next') === 'work') { forgetRegistration(); navigate('/login', { replace: true, state: { emailVerified: true } }); return; }
        const profile = await customerAuthService.ensureEmailProfile();
        if (!active) return;
        if (profile.needsName) { navigate('/customer/complete-profile', { replace: true, state: { returnTo: result.returnTo } }); return; }
        await refresh(); if (active) navigate(result.returnTo, { replace: true });
      } catch { if (active) setStatus('error'); }
    };
    run(); return () => { active = false; };
  }, []);
  useEffect(() => {
    if (status !== 'native' || native.client !== 'ios' || !native.url || nativeAttempted.current) return;
    const type = new URLSearchParams(new URL(originalUrl.current).hash.slice(1)).get('type');
    if (type !== 'signup' || !native.url.startsWith('https:')) return;
    nativeAttempted.current = true;
    window.location.assign(native.url);
  }, [status, native.url, native.client]);
  if (status === 'session-preserved') return <CustomerAuthLayout title={tr('email.verifiedTitle')} intro={tr('email.currentSessionPreserved')}><Link className="cb-primary ca-submit" to="/">{t('publicNav.home')}</Link></CustomerAuthLayout>;
  if (status === 'native-fallback') return <CustomerAuthLayout title={t(appConfig.environment === 'production' ? 'customerPassword.androidLiveOpenTitle' : 'customerPassword.androidOpenTitle')} intro={t(appConfig.environment === 'production' ? 'customerPassword.androidLiveFallback' : 'customerPassword.androidFallback')} />;
  if (status === 'native') return <CustomerAuthLayout title={t(native.client === 'android' ? appConfig.environment === 'production' ? 'customerPassword.androidLiveOpenTitle' : 'customerPassword.androidOpenTitle' : 'customerPassword.openAppTitle')} intro={t(native.client === 'android' ? 'customerPassword.androidOpenIntro' : 'customerPassword.openAppIntro')}><a className="cb-primary ca-submit" href={native.url}>{t('customerPassword.openApp')}</a></CustomerAuthLayout>;
  return <CustomerAuthLayout title={tr(status === 'error' ? 'email.invalidLinkTitle' : 'email.callbackTitle')} returnTo={returnTo}>
    <div className="ca-result">
      {status === 'error' ? <><Link2Off className="ca-state-icon" size={36} aria-hidden="true" /><p className="cb-alert" role="alert">{tr('email.invalidLink')}</p><Link className="cb-primary ca-submit" to="/customer/verify-email">{tr('email.requestConfirmation')}</Link><Link className="cb-text-button" to="/customer/forgot-password">{tr('forgotPassword')}</Link></> : <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={24} aria-hidden="true" />{tr('loading')}</p>}
    </div>
  </CustomerAuthLayout>;
}
