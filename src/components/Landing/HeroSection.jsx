import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Scissors, CheckCircle } from 'lucide-react';

export default function HeroSection() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';

  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-inner">
        {/* Content */}
        <div className="hero-content">
          <div className="hero-badge">
            <span className="hero-badge-dot" aria-hidden="true" />
            <span>{t('landing.hero.badge')}</span>
          </div>

          <h1 id="hero-title" className="hero-title">
            {t('landing.hero.titleStart')}{' '}
            <span className="hero-title-accent">{t('landing.hero.titleAccent')}</span>
          </h1>

          <p className="hero-subtitle">
            {t('landing.hero.subtitle')}
          </p>

          <div className="hero-cta">
            <Link to="/signup" className="hero-btn-primary">
              {t('landing.hero.cta')}
              <ArrowRight size={18} strokeWidth={2} />
            </Link>
            <Link to="/login" className="hero-btn-secondary">
              {t('landing.hero.secondaryCta')}
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

        {/* WhatsApp Mockup */}
        <div className="hero-visual">
          <div className="mockup-glow" aria-hidden="true" />
          <div className="whatsapp-mockup" role="img" aria-label={t('landing.hero.mockupAlt')}>
            <div className="phone-frame">
              <div className="phone-screen">
                {/* WhatsApp Header */}
                <div className="whatsapp-header">
                  <div className="whatsapp-avatar">
                    <Scissors size={18} strokeWidth={1.5} />
                  </div>
                  <div className="whatsapp-contact">
                    <div className="whatsapp-name">Barber++ Booking</div>
                    <div className="whatsapp-status">{t('landing.hero.whatsapp.online')}</div>
                  </div>
                </div>

                {/* Chat Messages */}
                <div className="whatsapp-chat">
                  {/* Customer Message */}
                  <div className="chat-bubble customer">
                    {t('landing.hero.whatsapp.msg1')}
                    <div className="chat-time">9:41 AM</div>
                  </div>

                  {/* Bot Response */}
                  <div className="chat-bubble bot">
                    {t('landing.hero.whatsapp.msg2')}
                    <div className="chat-options">
                      <span className="chat-option">Mohammed</span>
                      <span className="chat-option">Ali</span>
                      <span className="chat-option">Hassan</span>
                    </div>
                  </div>

                  {/* Customer Selection */}
                  <div className="chat-bubble customer">
                    Mohammed
                    <div className="chat-time">9:41 AM</div>
                  </div>

                  {/* Time Selection */}
                  <div className="chat-bubble bot">
                    {t('landing.hero.whatsapp.msg3')}
                    <div className="chat-options">
                      <span className="chat-option">10:00 AM</span>
                      <span className="chat-option">11:30 AM</span>
                      <span className="chat-option">2:00 PM</span>
                    </div>
                  </div>

                  {/* Customer Time */}
                  <div className="chat-bubble customer">
                    10:00 AM
                    <div className="chat-time">9:42 AM</div>
                  </div>

                  {/* Confirmation */}
                  <div className="chat-bubble bot chat-confirmation">
                    <div className="confirmation-icon">
                      <CheckCircle size={14} />
                      {t('landing.hero.whatsapp.confirmed')}
                    </div>
                    {t('landing.hero.whatsapp.msg4')}
                    <div className="chat-time">9:42 AM</div>
                  </div>
                </div>

                {/* Input Bar */}
                <div className="whatsapp-input">
                  <div className="whatsapp-input-field">
                    {t('landing.hero.whatsapp.inputPlaceholder')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
