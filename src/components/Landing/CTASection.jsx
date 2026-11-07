import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';

export default function CTASection() {
  const { t } = useTranslation();

  return (
    <section className="cta-section" aria-labelledby="cta-title">
      <div className="cta-inner animate-on-scroll">
        <h2 id="cta-title" className="cta-title">
          {t('landing.cta.title')}
        </h2>
        <p className="cta-subtitle">
          {t('landing.cta.subtitle')}
        </p>
        <Link to="/login" className="cta-button">
          {t('managerOnboarding.openWorkspace')}
          <ArrowRight size={18} strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}
