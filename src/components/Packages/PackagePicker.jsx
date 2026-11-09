import React from 'react';
import { useTranslation } from 'react-i18next';
import './Packages.css';

export default function PackagePicker({ offers, selected, services, onChange, disabled = false }) {
  const { t, i18n } = useTranslation();
  const arabic = i18n.language.startsWith('ar');
  const title = item => (arabic && item.nameAr) || item.name;
  const money = value => new Intl.NumberFormat(arabic ? 'ar-KW' : 'en-KW', { style: 'currency', currency: 'KWD' }).format(value);
  const date = value => new Intl.DateTimeFormat(arabic ? 'ar-KW' : 'en-KW', { dateStyle: 'medium', timeZone: 'Asia/Kuwait' }).format(new Date(`${value}T12:00:00Z`));
  if (!offers.length) return null;
  return <fieldset className="package-picker" disabled={disabled}>
    <legend>{t('packages.title')}</legend>
    {offers.map(offer => <label className={`package-choice ${selected === offer.id ? 'selected' : ''}`} key={offer.id}>
      <input type="radio" name="package-offer" value={offer.id} disabled={offer.unavailable} checked={selected === offer.id} onChange={() => onChange(offer)} />
      <span className="package-choice-copy"><strong>{title(offer)}</strong><span>{offer.serviceIds.map(id => services.find(service => service.id === id)).filter(Boolean).map(title).join(' + ')}</span>
        <span>{t('customerBooking.minutes', { count: offer.duration })} · {t('packages.until', { date: date(offer.endsOn) })}</span></span>
      <span className="package-choice-price">{offer.regularPrice > offer.price && <del>{money(offer.regularPrice)}</del>}<strong>{money(offer.price)}</strong></span>
    </label>)}
    {selected && <button type="button" className="cb-text-button" onClick={() => onChange(null)}>{t('packages.remove')}</button>}
  </fieldset>;
}
