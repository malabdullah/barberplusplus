import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, Heart, Scissors, Star, Store } from 'lucide-react';
import { addBookingDays, getKuwaitDate } from '../utils/customerBooking';
import './Landing.css';

export default function Landing() {
  const { t, i18n } = useTranslation();
  const tr = key => t(`landingRefresh.${key}`);
  const arabic = i18n.language.startsWith('ar');
  const locale = arabic ? 'ar-KW' : 'en-KW';
  const demoDate = new Date(`${addBookingDays(getKuwaitDate(), 1)}T14:30:00+03:00`);
  const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kuwait' }).format(demoDate);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait' }).format(demoDate);
  const newTime = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait' }).format(new Date(demoDate.getTime() + 90 * 60 * 1000));
  const price = new Intl.NumberFormat(locale, { style: 'currency', currency: 'KWD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(8);
  const rating = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).format(4.8);
  const count = new Intl.NumberFormat(locale).format(24);

  return <main className="landing-page landing-refresh" id="main-content" dir={arabic ? 'rtl' : 'ltr'}>
    <section className="lp-hero" aria-labelledby="hero-title">
      <img className="lp-hero-image" src="/landing/hero-barbershop.webp" width="1760" height="894" alt="" fetchPriority="high" decoding="async" />
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <h1 id="hero-title">{tr('titleStart')}<br />{tr('titleEnd')}</h1>
          <p>{tr('intro')}</p>
          <Link to="/book" className="lp-button lp-button-primary">{t('publicNav.book')}<ArrowRight size={20} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>

    <nav className="lp-booking-paths" aria-label={tr('bookingChoices')}>
      {[[CalendarDays, 'time'], [Scissors, 'barber'], [Store, 'shop']].map(([Icon, mode]) =>
        <Link key={mode} to="/book" state={{ bookingEntryMode: mode }} className="lp-booking-path" data-landing-booking={mode}>
          <Icon size={28} strokeWidth={1.65} aria-hidden="true" /><span>{t(`bookingFinder.${mode}Title`)}</span><ArrowRight className="lp-path-arrow" size={22} aria-hidden="true" />
        </Link>)}
    </nav>

    <section className="lp-customer-section" aria-labelledby="lp-customer-title">
      <div className="lp-customer-copy">
        <h2 id="lp-customer-title">{tr('customerTitleStart')}<br />{tr('customerTitleEnd')}</h2>
        <p>{tr('customerDescription')}</p>
      </div>
      <div className="lp-appointment-preview">
        <span className="lp-preview-label">{tr('demo')}</span>
        <div className="lp-preview-person">
          <img src="/landing/demo-barber.webp" alt="" width="600" height="600" loading="lazy" decoding="async" />
          <div><strong>{tr('barberName')}</strong><span className="lp-rating"><Star size={17} aria-hidden="true" fill="currentColor" /><bdi>{rating}</bdi><span>({count})</span><span className="sr-only">{tr('demoRating')}</span></span></div>
        </div>
        <div className="lp-preview-appointment">
          <Heart className="lp-preview-heart" size={20} fill="currentColor" aria-hidden="true" />
          <strong>{tr('packageName')}</strong><span className="lp-preview-price">{price}</span>
          <p className="lp-preview-date"><CalendarDays size={17} aria-hidden="true" /><span>{date} · {time}</span></p>
          <Link to="/customer/account#appointments" className="lp-text-link">{tr('viewAppointments')}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>

    <section className="lp-flexibility-section" aria-labelledby="lp-flexibility-title">
      <div className="lp-flexibility-inner">
        <div className="lp-flexibility-copy">
          <h2 id="lp-flexibility-title">{tr('flexibilityTitleStart')}<br />{tr('flexibilityTitleEnd')}</h2>
          <p>{tr('flexibilityDescription')}</p>
          <Link to="/customer/account#appointments" className="lp-button lp-button-outline">{tr('manageAppointments')}<ArrowRight size={20} aria-hidden="true" /></Link>
        </div>
        <div className="lp-reschedule-preview">
          <p className="lp-reschedule-caption">{tr('reschedulePreview')}</p>
          <div className="lp-reschedule-appointment">
            <strong>{tr('packageName')}</strong>
            <span>{tr('barberName')} · {date}</span>
          </div>
          <div className="lp-time-change">
            <dl><dt>{tr('currentTime')}</dt><dd><time dateTime={demoDate.toISOString()}>{time}</time></dd></dl>
            <ArrowRight size={24} aria-hidden="true" />
            <dl className="lp-new-time"><dt>{tr('newTime')}</dt><dd><time dateTime={new Date(demoDate.getTime() + 90 * 60 * 1000).toISOString()}>{newTime}</time></dd></dl>
          </div>
        </div>
      </div>
    </section>

    <section className="lp-shops-section" id="for-shops" aria-labelledby="lp-shops-title">
      <div className="lp-shops-inner">
        <div className="lp-shops-copy">
          <h2 id="lp-shops-title">{tr('shopsTitle')}</h2>
          <p>{tr('shopsDescription')}</p>
          <div className="lp-shop-actions">
            <Link to="/signup" className="lp-button lp-button-primary">{t('auth.createManagerAccount')}<ArrowRight size={20} aria-hidden="true" /></Link>
            <Link to="/login" className="lp-team-link">{t('publicNav.teamSignIn')}</Link>
          </div>
        </div>
        <img className="lp-shops-image" src="/landing/shop-interior.webp" width="1705" height="922" alt="" loading="lazy" decoding="async" />
      </div>
    </section>
  </main>;
}
