import BrandLogo from '../UI/BrandLogo';
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarCheck, Scissors } from 'lucide-react';

export default function HeroSection() {
  const { t } = useTranslation();

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

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-value">500+</span>
              <span className="hero-stat-label">{t('landing.hero.stats.barbershops')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">10K+</span>
              <span className="hero-stat-label">{t('landing.hero.stats.bookings')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">4.9</span>
              <span className="hero-stat-label">{t('landing.hero.stats.rating')}</span>
            </div>
          </div>
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
