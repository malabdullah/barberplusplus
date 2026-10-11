import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isStaging } from '../lib/runtimeConfig';

export default function EnvironmentBanner() {
  const { t } = useTranslation();
  useEffect(() => {
    if (!isStaging) return undefined;

    let robots = document.querySelector('meta[name="robots"]');
    const created = !robots;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow, noarchive';

    return () => {
      if (created) robots.remove();
    };
  }, []);

  if (!isStaging) return null;

  return (
    <div className="environment-banner" role="status">
      {t('environment.testBanner')}
    </div>
  );
}
