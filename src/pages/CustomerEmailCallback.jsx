import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, Link2Off } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { forgetEmail } from '../lib/customerEmailFlow';

export default function CustomerEmailCallback() {
  const { t } = useTranslation(); const tr = key => t(`customerAuth.${key}`);
  const { refresh } = useCustomerAuth(); const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); const [returnTo, setReturnTo] = useState('/customer/account');
  const callback = useRef(null);
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        callback.current ||= customerAuthService.finishEmail(window.location.href);
        const result = await callback.current;
        if (!active) return;
        forgetEmail(); setReturnTo(result.returnTo);
        if (result.recovery) { navigate('/customer/reset-password', { replace: true, state: { recovery: true, returnTo: result.returnTo } }); return; }
        const profile = await customerAuthService.ensureEmailProfile();
        if (!active) return;
        if (profile.needsName) { navigate('/customer/complete-profile', { replace: true, state: { returnTo: result.returnTo } }); return; }
        await refresh(); if (active) setStatus('verified');
      } catch { if (active) setStatus('error'); }
    };
    run(); return () => { active = false; };
  }, []);
  return <CustomerAuthLayout title={tr(status === 'verified' ? 'email.verifiedTitle' : status === 'error' ? 'email.invalidLinkTitle' : 'email.callbackTitle')} intro={status === 'verified' ? tr('email.verifiedIntro') : undefined} returnTo={returnTo}>
    <div className="ca-result">
      {status === 'error' ? <><Link2Off className="ca-state-icon" size={36} aria-hidden="true" /><p className="cb-alert" role="alert">{tr('email.invalidLink')}</p><Link className="cb-primary ca-submit" to="/customer/verify-email">{tr('email.requestConfirmation')}</Link><Link className="cb-text-button" to="/customer/forgot-password">{tr('forgotPassword')}</Link></> : status === 'verified' ? <><ShieldCheck className="ca-state-icon" size={36} aria-hidden="true" /><p role="status">{tr('email.verifiedStatus')}</p><Link className="cb-primary ca-submit" to={returnTo} replace>{tr(returnTo === '/book' ? 'bookNow' : 'myAccount')}</Link></> : <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={24} aria-hidden="true" />{tr('loading')}</p>}
    </div>
  </CustomerAuthLayout>;
}
