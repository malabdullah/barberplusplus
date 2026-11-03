import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { customerAuthService } from '../../services/customerAuth.service';

const scores = [1, 2, 3, 4, 5];

function StarRating({ name, label, score, onChange, disabled }) {
  const { t } = useTranslation();
  return (
    <fieldset className="ca-rating-group" disabled={disabled}>
      <legend>{label}</legend>
      <div className="ca-rating-stars">
        {scores.map(value => (
          <label key={value} className="ca-rating-star">
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={value}
              checked={score === value}
              onChange={() => onChange(value)}
              aria-label={t('customerAuth.rating.score', { count: value })}
            />
            <Star size={22} aria-hidden="true" fill={value <= score ? 'currentColor' : 'none'} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function BookingRating({ bookingId, shopRating, barberRating, onSaved }) {
  const { t } = useTranslation();
  const [shopChoice, setShopChoice] = useState(null);
  const [barberChoice, setBarberChoice] = useState(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const shopScore = shopChoice ?? shopRating;
  const barberScore = barberChoice ?? barberRating;
  const canSave = shopScore && barberScore && (shopScore !== shopRating || barberScore !== barberRating);

  const save = async event => {
    event.preventDefault();
    if (!canSave || pending) return;
    setPending(true);
    setMessage('');
    try {
      const saved = await customerAuthService.rateBooking(bookingId, shopScore, barberScore);
      onSaved(bookingId, saved);
      setShopChoice(null);
      setBarberChoice(null);
      setMessage('saved');
    } catch (error) {
      setMessage(error.message === 'BOOKING_NOT_RATEABLE' ? 'unavailable' : 'error');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="ca-rating" onSubmit={save}>
      <StarRating name={`shop-rating-${bookingId}`} label={t('customerAuth.rating.shop')}
        score={shopScore} disabled={pending} onChange={value => { setShopChoice(value); setMessage(''); }} />
      <StarRating name={`barber-rating-${bookingId}`} label={t('customerAuth.rating.barber')}
        score={barberScore} disabled={pending} onChange={value => { setBarberChoice(value); setMessage(''); }} />
      <button type="submit" className="cb-secondary" disabled={pending || !canSave}>
        {t(pending ? 'customerAuth.rating.saving' : 'customerAuth.rating.save')}
      </button>
      {message && <p className="ca-rating-message" role={message === 'saved' ? 'status' : 'alert'}>{t(`customerAuth.rating.${message}`)}</p>}
    </form>
  );
}
