import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CustomerHeader from '../components/Customer/CustomerHeader';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import './CustomerBooking.css';
import './CustomerAuth.css';

export default function CustomerEmailCallback() {
  const { t, i18n } = useTranslation();
  const { refresh } = useCustomerAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const callback = useRef(null);
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        callback.current ||= customerAuthService.finishEmail(window.location.href);
        const result = await callback.current;
        if (!active) return;
        if (result.recovery) { navigate('/customer/reset-password', { replace: true, state: { recovery: true, returnTo: result.returnTo } }); return; }
        const profile = await customerAuthService.ensureEmailProfile();
        if (!active) return;
        if (profile.needsName) { navigate('/customer/complete-profile', { replace: true, state: { returnTo: result.returnTo } }); return; }
        await refresh(); if (active) navigate(result.returnTo, { replace: true });
      } catch { if (active) setError(true); }
    };
    run(); return () => { active = false; };
  }, []);
  return <div className="customer-booking ca-page" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}><CustomerHeader /><main className="ca-main">
    <h1>{t('customerAuth.email.callbackTitle')}</h1>
    {error ? <><p className="cb-alert" role="alert">{t('customerAuth.email.invalidLink')}</p><Link to="/customer/sign-in">{t('customerAuth.signIn')}</Link></> : <p role="status">{t('customerAuth.loading')}</p>}
  </main></div>;
}
