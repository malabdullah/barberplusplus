import React from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, UserCheck, CalendarCheck } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: MessageCircle,
    titleKey: 'landing.howItWorks.step1.title',
    descKey: 'landing.howItWorks.step1.description'
  },
  {
    number: '02',
    icon: UserCheck,
    titleKey: 'landing.howItWorks.step2.title',
    descKey: 'landing.howItWorks.step2.description'
  },
  {
    number: '03',
    icon: CalendarCheck,
    titleKey: 'landing.howItWorks.step3.title',
    descKey: 'landing.howItWorks.step3.description'
  }
];

export default function HowItWorksSection() {
  const { t } = useTranslation();

  return (
    <section
      id="how-it-works"
      className="how-it-works-section"
      aria-labelledby="how-it-works-title"
    >
      <div className="how-it-works-inner">
        {/* Section Header */}
        <header className="section-header animate-on-scroll">
          <span className="section-eyebrow">{t('landing.howItWorks.eyebrow')}</span>
          <h2 id="how-it-works-title" className="section-title">
            {t('landing.howItWorks.title')}
          </h2>
          <p className="section-subtitle">
            {t('landing.howItWorks.subtitle')}
          </p>
        </header>

        {/* Steps */}
        <div className="steps-container">
          <div className="steps-line" aria-hidden="true" />

          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.number}
                className={`step-item animate-on-scroll animate-delay-${index + 1}`}
              >
                <div className="step-number">
                  <span className="step-number-text">{step.number}</span>
                  <Icon className="step-icon" size={28} strokeWidth={1.5} />
                </div>
                <div className="step-content">
                  <h3 className="step-title">{t(step.titleKey)}</h3>
                  <p className="step-description">{t(step.descKey)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
