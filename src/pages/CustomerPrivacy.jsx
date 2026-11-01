import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './CustomerBooking.css';
import './CustomerAuth.css';
import './CustomerPrivacy.css';

export default function CustomerPrivacy() {
  const { t, i18n } = useTranslation();
  const sections = t('customerPrivacy.sections', { returnObjects: true });
  useEffect(() => { document.title = `${t('customerPrivacy.title')} | Barber++`; }, [t, i18n.language]);
  return <div className="customer-booking ca-page" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>

    <main className="ca-main cp-main">
      <Link className="cb-text-button" to="/book">{t('customerPrivacy.back')}</Link>
      <h1>{t('customerPrivacy.title')}</h1>
      <p className="cp-updated">{t('customerPrivacy.updated')}</p>
      <p>{t('customerPrivacy.intro')}</p>
      {sections.map((section, index) => <section key={index} aria-labelledby={`privacy-section-${index}`}>
        <h2 id={`privacy-section-${index}`}>{section.title}</h2><p>{section.text}</p>
      </section>)}
      <a href="mailto:alabdullah.cs@gmail.com" aria-label={t('customerPrivacy.contact')} dir="ltr">alabdullah.cs@gmail.com</a>
    </main>
  </div>;
}
