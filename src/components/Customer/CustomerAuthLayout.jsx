import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import '../../pages/CustomerBooking.css';
import '../../pages/CustomerAuth.css';

export default function CustomerAuthLayout({ title, intro, children, returnTo = '/customer/account', backToBooking = false, accountType = 'customer' }) {
  const { t, i18n } = useTranslation();
  useEffect(() => { document.title = `${title} | Barber++`; }, [title]);
  return <div className="customer-booking ca-page ca-auth" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>
    <main className="ca-main">
      <Link className="cb-text-button ca-back" to={accountType === 'team' ? '/' : backToBooking ? '/book' : '/customer/sign-in'} state={{ returnTo }}><ArrowLeft size={18} aria-hidden="true" />{accountType === 'team' ? t('teamAuth.backHome') : t(`customerAuth.${backToBooking ? 'backToBooking' : 'backToSignIn'}`)}</Link>
      <section className="ca-panel" aria-labelledby="customer-auth-title">
        <header className="ca-heading"><p className="ca-eyebrow">{t(accountType === 'team' ? 'teamAuth.eyebrow' : 'customerAuth.customerAccount')}</p><h1 id="customer-auth-title">{title}</h1>{intro && <p className="cb-intro">{intro}</p>}</header>
        {children}
      </section>
      <footer className="ca-footer"><Link to={accountType === 'team' ? '/customer/sign-in' : '/book'}>{t(accountType === 'team' ? 'publicNav.customerSignIn' : 'customerAuth.continueGuest')}</Link><Link to="/privacy">{t('customerPrivacy.title')}</Link></footer>
    </main>
  </div>;
}
