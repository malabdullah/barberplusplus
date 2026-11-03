import React from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useCustomerFavourites } from '../../context/CustomerFavouritesContext';
import { favouriteKey, rememberFavouriteIntent } from '../../utils/customerFavourites';
import { rememberBookingReturn } from '../../utils/customerBookingDraft';
import '../../pages/CustomerFavourites.css';
export default function FavouriteButton({ kind, targetId, name, disabled = false }) {
  const { customer, loading: authLoading } = useCustomerAuth();
  const { items, loading, busy, busyKey, toggle } = useCustomerFavourites();
  const { t } = useTranslation(); const navigate = useNavigate();
  const selected = items.some(item => favouriteKey(item.kind, item.targetId) === favouriteKey(kind, targetId));
  return <button type="button" className="cf-heart" aria-pressed={selected} aria-label={t('customerFavourites.labelNamed', { name })} title={t(`customerFavourites.${selected ? 'removeNamed' : 'saveNamed'}`, { name })} disabled={disabled || authLoading || loading || busy} onClick={() => {
    if (!customer) { rememberFavouriteIntent(kind, targetId); rememberBookingReturn(); navigate('/customer/sign-in?next=book', { state: { returnTo: '/book' } }); }
    else toggle(kind, targetId);
  }}>{busyKey === favouriteKey(kind, targetId) ? <Loader2 size={19} className="cb-spinner" aria-hidden="true" /> : <Heart size={20} fill={selected ? 'currentColor' : 'none'} aria-hidden="true" />}</button>;
}
