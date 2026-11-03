import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCustomerFavourites } from '../../context/CustomerFavouritesContext';
export default function FavouriteFeedback({ showSaved = true }) {
  const { error, feedback, reload, busy, loading } = useCustomerFavourites();
  const { t } = useTranslation();
  if (error) return <div className="cb-alert cf-feedback" role="alert">{t(`customerFavourites.errors.${['FAVOURITE_UNAVAILABLE', 'FAVOURITES_LIMIT'].includes(error) ? error : 'UNAVAILABLE'}`)} <button type="button" className="cb-text-button" disabled={busy || loading} onClick={reload}>{t('customerBooking.retry')}</button></div>;
  if (feedback === 'saved' && !showSaved) return null;
  return feedback ? <p className="cf-feedback" role="status">{t(`customerFavourites.${feedback}`)}</p> : null;
}
