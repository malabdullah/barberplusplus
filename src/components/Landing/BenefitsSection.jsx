import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Languages,
  Smartphone,
  Bell,
  Palette,
  Zap
} from 'lucide-react';

const benefits = [
  {
    icon: MessageSquare,
    titleKey: 'landing.benefits.whatsapp.title',
    descKey: 'landing.benefits.whatsapp.description'
  },
  {
    icon: Languages,
    titleKey: 'landing.benefits.multilingual.title',
    descKey: 'landing.benefits.multilingual.description'
  },
  {
    icon: Smartphone,
    titleKey: 'landing.benefits.mobile.title',
    descKey: 'landing.benefits.mobile.description'
  },
  {
    icon: Bell,
    titleKey: 'landing.benefits.notifications.title',
    descKey: 'landing.benefits.notifications.description'
  },
  {
    icon: Palette,
    titleKey: 'landing.benefits.themes.title',
    descKey: 'landing.benefits.themes.description'
  },
  {
    icon: Zap,
    titleKey: 'landing.benefits.intuitive.title',
    descKey: 'landing.benefits.intuitive.description'
  }
];

export default function BenefitsSection() {
  const { t } = useTranslation();

  return (
    <section
      id="benefits"
      className="benefits-section"
      aria-labelledby="benefits-title"
    >
      <div className="benefits-inner">
        {/* Section Header */}
        <header className="section-header animate-on-scroll">
          <span className="section-eyebrow">{t('landing.benefits.eyebrow')}</span>
          <h2 id="benefits-title" className="section-title">
            {t('landing.benefits.title')}
          </h2>
          <p className="section-subtitle">
            {t('landing.benefits.subtitle')}
          </p>
        </header>

        {/* Benefits Grid */}
        <div className="benefits-grid">
          {benefits.map((benefit, index) => {
            const Icon = benefit.icon;
            return (
              <article
                key={benefit.titleKey}
                className={`benefit-card animate-on-scroll animate-delay-${index + 1}`}
              >
                <div className="benefit-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.5} />
                </div>
                <div className="benefit-content">
                  <h3 className="benefit-title">{t(benefit.titleKey)}</h3>
                  <p className="benefit-description">{t(benefit.descKey)}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
