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

export default function BookingRating({ bookingId, shopRating, barberRating, review, onSaved }) {
  const { t } = useTranslation();
  const [shopChoice, setShopChoice] = useState(null);
  const [barberChoice, setBarberChoice] = useState(null);
  const [reviewDraft, setReviewDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const shopScore = shopChoice ?? shopRating;
  const barberScore = barberChoice ?? barberRating;
  const reviewText = reviewDraft ?? review ?? '';
  const canSave = shopScore && barberScore && (shopScore !== shopRating || barberScore !== barberRating ||
    reviewText.trim() !== (review ?? ''));

  const save = async event => {
    event.preventDefault();
    if (!canSave || pending) return;
    setPending(true);
    setMessage('');
    try {
      const saved = await customerAuthService.rateBooking(bookingId, shopScore, barberScore, reviewText.trim());
      onSaved(bookingId, saved);
      setShopChoice(null);
      setBarberChoice(null);
      setReviewDraft(null);
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
      <label className="ca-rating-review">
        {t('customerAuth.rating.reviewLabel')}
        <textarea className="form-input" rows={3} maxLength={1000} value={reviewText} disabled={pending}
          onChange={event => { setReviewDraft(event.target.value); setMessage(''); }}
          aria-describedby={'review-visibility-' + bookingId} />
        <small id={'review-visibility-' + bookingId}>{t('customerAuth.rating.reviewVisibility')}</small>
      </label>
      <button type="submit" className="cb-secondary" disabled={pending || !canSave}>
        {t(pending ? 'customerAuth.rating.saving' : 'customerAuth.rating.save')}
      </button>
      {message && <p className="ca-rating-message" role={message === 'saved' ? 'status' : 'alert'}>{t(`customerAuth.rating.${message}`)}</p>}
    </form>
  );
}
