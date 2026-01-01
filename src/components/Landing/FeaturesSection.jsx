import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  Calendar,
  Users,
  Scissors,
  TrendingUp,
  FileText
} from 'lucide-react';

const features = [
  {
    icon: Building2,
    titleKey: 'landing.features.multiBranch.title',
    descKey: 'landing.features.multiBranch.description'
  },
  {
    icon: Calendar,
    titleKey: 'landing.features.bookingControl.title',
    descKey: 'landing.features.bookingControl.description'
  },
  {
    icon: Users,
    titleKey: 'landing.features.staffManagement.title',
    descKey: 'landing.features.staffManagement.description'
  },
  {
    icon: Scissors,
    titleKey: 'landing.features.services.title',
    descKey: 'landing.features.services.description'
  },
  {
    icon: TrendingUp,
    titleKey: 'landing.features.analytics.title',
    descKey: 'landing.features.analytics.description'
  },
  {
    icon: FileText,
    titleKey: 'landing.features.activityLogs.title',
    descKey: 'landing.features.activityLogs.description'
  }
];

export default function FeaturesSection() {
  const { t } = useTranslation();

  return (
    <section
      id="features"
      className="features-section"
      aria-labelledby="features-title"
    >
      <div className="features-inner">
        {/* Section Header */}
        <header className="section-header animate-on-scroll">
          <span className="section-eyebrow">{t('landing.features.eyebrow')}</span>
          <h2 id="features-title" className="section-title">
            {t('landing.features.title')}
          </h2>
          <p className="section-subtitle">
            {t('landing.features.subtitle')}
          </p>
        </header>

        {/* Features Grid */}
        <div className="features-grid">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.titleKey}
                className={`feature-card animate-on-scroll animate-delay-${index + 1}`}
              >
                <div className="feature-icon" aria-hidden="true">
                  <Icon size={24} strokeWidth={1.5} />
                </div>
                <h3 className="feature-title">{t(feature.titleKey)}</h3>
                <p className="feature-description">{t(feature.descKey)}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
