import React from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './CustomerAuth.css';

const supportEmail = 'support@barberplusplus.com';

export default function ContactSupport() {
  const { t } = useTranslation();
  return (
    <main className="ca-main">
      <Link className="ca-back" to="/">{t('common.brandHome')}</Link>
      <section className="ca-panel">
        <h1>{t('settings.contactSupport')}</h1>
        <p>{t('support.description')}</p>
        <ul>
          <li>{t('support.customers')}</li>
          <li>{t('support.barbers')}</li>
          <li>{t('support.managers')}</li>
        </ul>
        <p>{t('support.whatToInclude')}</p>
        <a className="btn btn-primary" href={'mailto:' + supportEmail}>
          <Mail size={18} aria-hidden="true" />
          {t('support.email')}
        </a>
        <p dir="ltr">{supportEmail}</p>
      </section>
    </main>
  );
}
