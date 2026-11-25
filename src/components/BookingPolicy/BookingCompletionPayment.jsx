import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bookingsService } from '../../services/bookings.service';

export default function BookingCompletionPayment({ booking }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState(null);
  useEffect(() => {
    let active = true;
    setMethod(null);
    if (booking.status === 'completed') bookingsService.completionPayment(booking.id)
      .then(result => { if (active) setMethod(result.method); }).catch(() => {});
    return () => { active = false; };
  }, [booking.id, booking.status]);
  if (!['cash', 'card', 'transfer', 'other', 'unpaid', 'online', 'recorded', 'free'].includes(method)) return null;
  return <div className="booking-detail-row"><div><span className="detail-label">{t('bookingCompletion.method')}</span>
    <span className="detail-value">{t(`bookingCompletion.${method}`)}</span></div></div>;
}
