import React from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Phone } from 'lucide-react';

export default function BookingContact({ booking }) {
  const { t } = useTranslation();
  const email = typeof booking.customerEmail === 'string' ? booking.customerEmail : '';
  const safeEmail = email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
  return <>
    {email && <div className="booking-detail-row">
      <Mail size={18} strokeWidth={1.5} aria-hidden="true" />
      <div style={{ minWidth: 0 }}><span className="detail-label">{t('common.email')}</span>
        <span className="detail-value" style={{ overflowWrap: 'anywhere' }}>
          {safeEmail ? <a href={`mailto:${email}`} dir="ltr">{email}</a> : <bdi>{email}</bdi>}
        </span>
      </div>
    </div>}
    {booking.customerPhone && <div className="booking-detail-row">
      <Phone size={18} strokeWidth={1.5} aria-hidden="true" />
      <div><span className="detail-label">{t('common.phone')}</span>
        <span className="detail-value"><bdi>{booking.customerCountryCode} {booking.customerPhone}</bdi></span>
      </div>
    </div>}
  </>;
}
