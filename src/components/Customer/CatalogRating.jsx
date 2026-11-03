import React from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function CatalogRating({ rating }) {
  const { t, i18n } = useTranslation();
  if (rating === undefined) return null;
  if (!rating?.count) return <span className="cb-catalog-rating">{t('customerBooking.catalogRating.none')}</span>;

  const locale = i18n.resolvedLanguage;
  const average = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating.average);
  const number = new Intl.NumberFormat(locale).format(rating.count);
  return (
    <span className="cb-catalog-rating">
      <Star size={15} fill="currentColor" aria-hidden="true" />
      <span className="sr-only">{t('customerBooking.catalogRating.score', { average })}</span>
      <bdi className="cb-catalog-score" aria-hidden="true">{average}</bdi>
      <bdi aria-hidden="true">({number})</bdi>
      <span className="sr-only">{t('customerBooking.catalogRating.count', { count: rating.count, number })}</span>
    </span>
  );
}
