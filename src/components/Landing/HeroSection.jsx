import BrandLogo from '../UI/BrandLogo';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarCheck, Scissors } from 'lucide-react';
import { customerBookingService } from '../../services/customerBooking.service';

export default function HeroSection() {
  const { t, i18n } = useTranslation();
  const [statistics, setStatistics] = useState(null);
  const [statisticsUnavailable, setStatisticsUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const totals = await customerBookingService.getStatistics();
        if (active) { setStatistics(totals); setStatisticsUnavailable(false); }
      } catch {
        if (active) { setStatistics(null); setStatisticsUnavailable(true); }
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const count = key => statistics ? new Intl.NumberFormat(i18n.language).format(statistics[key]) : '—';

  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-inner">
        {/* Content */}
        <div className="hero-content">
          <h1 id="hero-title" className="hero-title">
            {t('publicNav.hero.titleStart')}{' '}
            <span className="hero-title-accent">{t('publicNav.hero.titleAccent')}</span>
          </h1>

          <p className="hero-subtitle">
            {t('publicNav.hero.subtitle')}
          </p>

          <div className="hero-cta">
            <Link to="/book" className="hero-btn-primary">
              {t('publicNav.book')}
              <ArrowRight size={18} strokeWidth={2} />
            </Link>
            <Link to="/signup" className="hero-btn-secondary">
              {t('publicNav.hero.shopCta')}
            </Link>
          </div>

          <div className="hero-stats" aria-busy={!statistics && !statisticsUnavailable}>
            <div className="hero-stat">
              <span className="hero-stat-value">{count('shops')}</span>
              <span className="hero-stat-label">{t('landing.hero.stats.barbershops')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{count('monthlyBookings')}</span>
              <span className="hero-stat-label">{t('landing.hero.stats.bookings')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{count('barbers')}</span>
              <span className="hero-stat-label">{t('landing.hero.stats.barbers')}</span>
            </div>
          </div>
          {statisticsUnavailable && <p className="hero-stats-unavailable" role="status">{t('landing.hero.stats.unavailable')}</p>}
        </div>

        <div className="hero-visual" role="img" aria-label={t('landing.hero.preview.alt')}>
          <div className="mockup-glow" aria-hidden="true" />
          <div className="booking-preview">
            <div className="booking-preview-header"><BrandLogo size="compact" /></div>
            <div className="booking-preview-body">
              <span className="booking-preview-eyebrow">{t('landing.hero.preview.eyebrow')}</span>
              <h2>{t('landing.hero.preview.title')}</h2>
              <div className="booking-preview-card"><CalendarCheck size={24} /><div><strong>{t('landing.hero.preview.appointments')}</strong><span>{t('landing.hero.preview.manage')}</span></div></div>
              <div className="booking-preview-card"><Scissors size={24} /><div><strong>{t('landing.hero.preview.team')}</strong><span>{t('landing.hero.preview.branches')}</span></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
