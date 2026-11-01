import React from 'react';
import './BrandLogo.css';

// Keep the artwork LTR in every locale and use the existing symbol artwork on
// small public headers without cropping or changing the approved logo.
export default function BrandLogo({ tone = 'auto', size = 'default', tagline, decorative = false, symbolOnSmallScreens = false }) {
  return (
    <span className={`brand-logo brand-logo--${tone} brand-logo--${size}${symbolOnSmallScreens ? ' brand-logo--responsive-symbol' : ''}`} dir="ltr" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Barber++'} aria-hidden={decorative || undefined}>
      <span className="brand-logo-artwork">
        {['light', 'dark'].map(tone => <picture key={tone}>
          {symbolOnSmallScreens && <source media="(max-width: 600px)" srcSet={`/brand/barber-symbol-${tone}.svg`} width="260" height="304" />}
          <img className={`brand-logo-${tone}`} src={`/brand/barber-horizontal-${tone}.svg`} width="588" height="104" alt="" decoding="async" />
        </picture>)}
      </span>
      {tagline && <span className="brand-logo-tagline" dir="auto">{tagline}</span>}
    </span>
  );
}
