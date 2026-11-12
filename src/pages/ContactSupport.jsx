import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useAccountAccess from '../hooks/useAccountAccess';
import AccountAccessState from '../components/AccountAccessState';
import { accountSettingsPath } from './AccountTools';
import './CustomerBooking.css';
import './AccountTools.css';
export default function ContactSupport() {
  const { t, i18n } = useTranslation();
  const access = useAccountAccess();
  const [params] = useSearchParams();
  const back = params.get('audience') === 'customer' || access.identity?.role === 'customer' ? '/customer/account' : accountSettingsPath(access.identity?.role);
  return <main className="account-tools account-support" dir={i18n.dir()}>
    {!access.identity ? <AccountAccessState access={access} /> : <>
      <Link className="account-tools-back" to={back}><ArrowLeft size={17} aria-hidden="true" />{t('common.back')}</Link>
      <header className="account-tools-heading"><div><Mail size={25} aria-hidden="true" /><h1>{t('settings.contactSupport')}</h1></div></header>
      <section className="account-support-panel"><p>{t('support.description')}</p><a className="cb-primary" href="mailto:support@barberplusplus.com"><Mail size={19} aria-hidden="true" />{t('support.email')}</a><span dir="ltr">support@barberplusplus.com</span></section>
    </>}
  </main>;
}
