import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../context/AppContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
export default function CustomerHeader({ busy = false }) {
  const { t, i18n } = useTranslation();
  const { setLanguage } = useApp();
  const { customer } = useCustomerAuth();
  const location = useLocation();
  const arabic = i18n.language.startsWith('ar');
  return <header className="cb-header">
    <Link to="/book" className="cb-wordmark" dir="ltr" aria-label="Barber++">Barber<span>++</span></Link>
    <span className="cb-header-label">{t('customerBooking.header')}</span>
    <Link className="cb-account-link" to={customer ? '/customer/account' : '/customer/sign-in'} state={{ returnTo: location.pathname === '/book' ? '/book' : '/customer/account' }}>{customer?.name || t('customerAuth.signIn')}</Link>
    <button type="button" className="cb-language" onClick={() => setLanguage(arabic ? 'en' : 'ar')} lang={arabic ? 'en' : 'ar'} disabled={busy}>{arabic ? 'English' : 'العربية'}</button>
  </header>;
}
