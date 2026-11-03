import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Heart, Loader2, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { useCustomerFavourites } from '../context/CustomerFavouritesContext';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import FavouriteButton from '../components/Customer/FavouriteButton';
import FavouriteFeedback from '../components/Customer/FavouriteFeedback';
import BookingImage from '../components/Customer/BookingImage';
import { favouriteBookingDraft } from '../utils/customerFavourites';
import { saveBookingDraft } from '../utils/customerBookingDraft';
import { shopWording } from '../utils/customerTerminology';
import { customerBookingService } from '../services/customerBooking.service';
import './CustomerBooking.css';
import './CustomerAuth.css';
import './CustomerAccount.css';
import './CustomerFavourites.css';
export default function CustomerFavourites() {
  const { customer, loading: authLoading } = useCustomerAuth();
  const { items, loading, error, busy } = useCustomerFavourites();
  const { t, i18n } = useTranslation(); const navigate = useNavigate();
  const tr = key => t(`customerFavourites.${key}`);
  const arabic = i18n.language.startsWith('ar');
  const [booking, setBooking] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [review, setReview] = useState(null);
  const dialog = useRef(null);
  useEffect(() => { if (review && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [review]);
  const account = useRef(customer?.id); account.current = customer?.id;
  usePublicNavigationBusy(Boolean(booking));
  useEffect(() => { document.title = `${tr('title')} | Barber++`; }, [t]);
  useEffect(() => { setBooking(''); setBookingError(''); setReview(null); }, [customer?.id]);
  const display = (en, ar) => shopWording(arabic && ar || en || '');
  const startBooking = async (item, acceptedLocation = false) => {
    if (booking || busy || loading) return;
    if (item.locationChanged && !acceptedLocation) { setReview(item); return; }
    const owner = customer.id;
    setBooking(item.targetId); setBookingError('');
    try {
      const catalog = await customerBookingService.getCatalog();
      if (owner !== account.current) return;
      const draft = favouriteBookingDraft(item, catalog);
      // Revalidate a move that happened after the page was loaded as well.
      if (item.kind === 'barber' && draft.barberId && draft.branchId !== item.shopId) {
        const shop = catalog.branches.find(value => value.id === draft.branchId);
        setReview({ ...item, locationChanged: true, shopId: shop.id, shopName: shop.name, shopNameAr: shop.nameAr, city: shop.city, cityAr: shop.cityAr });
        return;
      }
      saveBookingDraft(draft); navigate('/book', { state: { bookingDraft: draft } });
    } catch { if (owner === account.current) setBookingError(item.targetId); }
    finally { if (owner === account.current) setBooking(''); }
  };
  if (!authLoading && !customer) return <Navigate to="/customer/sign-in" replace />;
  return <div className="customer-booking ca-page" dir={arabic ? 'rtl' : 'ltr'}><main className="ca-main ca-account cf-page">
    <Link className="cb-text-button ca-back" to="/customer/account"><ArrowLeft size={18} aria-hidden="true" />{tr('backAccount')}</Link>
    <header className="ca-account-heading"><div><p className="ca-eyebrow">{t('customerAuth.customerAccount')}</p><h1>{tr('title')}</h1><p className="cb-intro">{tr('intro')}</p></div><Link className="cb-secondary" to="/book">{tr('browse')}</Link></header>
    <FavouriteFeedback />
    {authLoading || loading ? <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={22} aria-hidden="true" />{t('customerAuth.loading')}</p> : !error && !items.length ? <section className="cf-empty"><Heart size={34} aria-hidden="true" /><h2>{tr('emptyTitle')}</h2><p>{tr('emptyHint')}</p><Link className="cb-primary" to="/book">{tr('browse')}</Link></section> : <>
      {['barber', 'shop'].map(kind => <section key={kind} className="cf-group" aria-labelledby={`favourite-${kind}-title`}><header><h2 id={`favourite-${kind}-title`}>{tr(kind === 'barber' ? 'barbers' : 'shops')}</h2><span>{items.filter(item => item.kind === kind).length}</span></header>
        {!items.some(item => item.kind === kind) ? <p className="cf-group-empty">{tr(kind === 'barber' ? 'noBarbers' : 'noShops')}</p> : <div className="cf-list">{items.filter(item => item.kind === kind).map(item => <article className="cf-item" key={`${kind}:${item.targetId}`}>
          <BookingImage src={item.imageUrl} name={display(item.name, item.nameAr)} person={kind === 'barber'} />
          <div className="cf-item-copy"><h3>{display(item.name, item.nameAr)}</h3>{kind === 'barber' && <p>{display(item.shopName, item.shopNameAr)}</p>}<p className="cf-location"><MapPin size={15} aria-hidden="true" />{display(item.city, item.cityAr)}</p>
            {!item.available && <p className="cf-notice">{tr('unavailable')}</p>}{item.available && item.locationChanged && <p className="cf-notice">{tr('locationChanged')}</p>}
            <div className="cf-book-actions">{item.available ? <button type="button" className="cb-secondary" disabled={Boolean(booking) || busy} onClick={() => startBooking(item)}>{booking === item.targetId && <Loader2 className="cb-spinner" size={17} aria-hidden="true" />}{tr(item.locationChanged ? 'reviewLocation' : 'book')}<ArrowRight size={17} aria-hidden="true" /></button> : <Link className="cb-text-button" to="/book">{tr('alternatives')}</Link>}</div>
            {bookingError === item.targetId && <p role="alert" className="cb-alert">{tr('bookingError')}</p>}
          </div><FavouriteButton kind={kind} targetId={item.targetId} name={display(item.name, item.nameAr)} disabled={Boolean(booking)} />
        </article>)}</div>}
      </section>)}
    </>}
    {review && <dialog ref={dialog} className="cf-review" aria-labelledby="cf-review-title" onCancel={event => { if (booking) event.preventDefault(); else setReview(null); }}><h2 id="cf-review-title">{tr('reviewLocation')}</h2><p>{tr('locationChanged')}</p><strong>{display(review.name, review.nameAr)}</strong><p>{display(review.shopName, review.shopNameAr)} · {display(review.city, review.cityAr)}</p><div><button type="button" className="cb-primary" disabled={Boolean(booking)} onClick={() => startBooking(review, true)}>{tr('continueServices')}</button><button type="button" className="cb-secondary" disabled={Boolean(booking)} onClick={() => setReview(null)}>{t('customerAuth.cancel')}</button></div></dialog>}
  </main></div>;
}
