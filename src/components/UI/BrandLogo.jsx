import React from 'react';
import './BrandLogo.css';

// Keep the artwork LTR in every locale. Booking uses its own light surface even
// when the staff/marketing theme is dark, so callers can explicitly set tone.
export default function BrandLogo({ tone = 'auto', size = 'default', tagline, decorative = false }) {
  return (
    <span className={`brand-logo brand-logo--${tone} brand-logo--${size}`} dir="ltr" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Barber++'} aria-hidden={decorative || undefined}>
      <span className="brand-logo-artwork">
        <img className="brand-logo-light" src="/brand/barber-horizontal-light.svg" width="588" height="104" alt="" decoding="async" />
        <img className="brand-logo-dark" src="/brand/barber-horizontal-dark.svg" width="588" height="104" alt="" decoding="async" />
      </span>
      {tagline && <span className="brand-logo-tagline" dir="auto">{tagline}</span>}
    </span>
  );
}
