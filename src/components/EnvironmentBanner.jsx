import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { appConfig, isStaging } from '../lib/runtimeConfig';

export default function EnvironmentBanner() {
  const { t } = useTranslation();
  const bannerRef = useRef(null);
  const showBanner = isStaging || Boolean(appConfig.cloudProfile);
  useLayoutEffect(() => {
    if (!showBanner) return undefined;

    const style = document.documentElement.style;
    const property = '--environment-banner-height';
    const previous = style.getPropertyValue(property);
    const measure = () => style.setProperty(property, `${bannerRef.current.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(bannerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (previous) style.setProperty(property, previous);
      else style.removeProperty(property);
    };
  }, [showBanner]);
  useEffect(() => {
    if (!showBanner) return undefined;

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
  }, [showBanner]);

  if (!showBanner) return null;

  return (
    <div className="environment-banner" role="status" ref={bannerRef}>
      {t(appConfig.cloudProfile === 'staging' ? 'environment.stagingBanner' : 'environment.testBanner')}
    </div>
  );
}
