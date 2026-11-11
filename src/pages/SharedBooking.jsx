import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Clock, Loader2, MapPin } from 'lucide-react';
import { bookingShareService } from '../services/bookingShare.service';
import { downloadBookingCalendar, safeBookingUrl } from '../utils/customerBooking';
import BookingImage from '../components/Customer/BookingImage';
import { shopWording } from '../utils/customerTerminology';
import './CustomerAuth.css';
import './CustomerBooking.css';
import '../components/Customer/BookingShare.css';

export default function SharedBooking() {
  const { t, i18n } = useTranslation();
  const tr = key => t(`bookingShare.${key}`);
  const { hash } = useLocation();
  const token = hash.slice(1);
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const current = useRef(0);
  const arabic = i18n.resolvedLanguage?.startsWith('ar');
  useEffect(() => {
    const id = ++current.current;
    setBooking(null); setError(''); setLoading(true);
    if (!/^[0-9a-f]{64}$/.test(token)) { setLoading(false); setError('LINK_UNAVAILABLE'); return undefined; }
    bookingShareService.view(token).then(value => { if (id === current.current) setBooking(value); })
      .catch(failure => { if (id === current.current) setError(failure.message); })
      .finally(() => { if (id === current.current) setLoading(false); });
    return () => { current.current += 1; };
  }, [token, revision]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision(value => value + 1); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.clearInterval(interval); };
  }, []);
  useEffect(() => { document.title = `${tr('title')} | Barber++`; }, [t]); // No appointment details in browser titles/previews.
  const localName = (en, ar) => arabic && ar ? ar : en;
  const shop = booking && shopWording(localName(booking.shop, booking.shopAr));
  const barber = booking && localName(booking.barber, booking.barberAr);
  const start = booking && new Date(`${booking.date}T${booking.time}:00+03:00`);
  const format = (date, options) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: 'Asia/Kuwait', ...options }).format(date);
  const services = booking?.services?.map(service => ({ name: localName(service.name, service.nameAr), quantity: Number(service.quantity) || 1 })) || [];
  const packageName = booking?.package && localName(booking.package.name, booking.package.nameAr);
  const directions = safeBookingUrl(booking?.locationUrl);
  const cancelled = ['cancelled', 'no_show'].includes(booking?.status);
  const image = value => {
    try { const url = new URL(value, window.location.origin); if (url.origin === window.location.origin && url.pathname.startsWith('/booking-demo/')) return url.href; return url.protocol === 'https:' && url.pathname.includes('/storage/v1/object/public/') ? url.href : null; } catch { return null; }
  };
  const calendar = () => downloadBookingCalendar({ id: booking.reference, reference: booking.reference, date: booking.date, time: booking.time,
    duration: booking.duration, services, package: packageName ? { name: packageName } : null, branchName: shop, address: booking.address, status: booking.status });
  return <div className="customer-booking bs-page" dir={arabic ? 'rtl' : 'ltr'}><main className="bs-main">
    {loading ? <div className="bs-state" role="status"><Loader2 className="cb-spinner" size={26} aria-hidden="true" /><p>{tr('loading')}</p></div>
      : error ? <section className="bs-state" aria-labelledby="bs-unavailable"><span className="bs-share-symbol"><Clock size={26} aria-hidden="true" /></span><h1 id="bs-unavailable">{tr(error === 'LINK_UNAVAILABLE' ? 'unavailableTitle' : 'errorTitle')}</h1><p>{tr(error === 'LINK_UNAVAILABLE' ? 'unavailable' : 'error')}</p>{error !== 'LINK_UNAVAILABLE' && <button className="cb-secondary" type="button" onClick={() => setRevision(value => value + 1)}>{tr('refresh')}</button>}</section>
        : booking && <article className="bs-ticket" aria-labelledby="bs-title">
          <header className="bs-ticket-header"><p className="ca-eyebrow">{tr('appointment')}</p><span className={`bs-status bs-status--${booking.status}`}>{t(`bookingShare.status.${booking.status}`, { defaultValue: tr('appointment') })}</span></header>
          <section className="bs-when">
            <p className="bs-date">{format(start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <h1 id="bs-title">{format(start, { timeStyle: 'short' })}</h1>
            <p className="bs-time-meta">{t('bookingShare.endsAt', { time: format(new Date(start.getTime() + booking.duration * 60000), { timeStyle: 'short' }) })} · {t('bookingShare.minutes', { count: booking.duration })} · {tr('kuwaitTime')}</p>
          </section>
          <div className="bs-people">
            <section className="bs-person"><div className="bs-photo"><BookingImage src={image(booking.shopImage)} name="" /></div><div><p className="bs-label">{tr('shop')}</p><h2>{shop}</h2><p>{[booking.city, booking.address].filter(Boolean).join(' · ')}</p></div></section>
            <section className="bs-person"><div className="bs-photo bs-photo--barber"><BookingImage src={image(booking.barberImage)} name="" person /></div><div><p className="bs-label">{tr('barber')}</p><h2>{barber}</h2></div></section>
          </div>
          <section className="bs-services" aria-labelledby="bs-services-title"><h2 id="bs-services-title">{packageName || tr('services')}</h2><ul>{services.map((service, index) => <li key={index}><span>{service.name}</span>{service.quantity > 1 && <span>×{service.quantity}</span>}</li>)}</ul></section>
          <div className="bs-total"><span>{tr('total')}</span><strong>{new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'KWD' }).format(booking.price)}</strong></div>
          <div className="bs-ticket-actions">{directions && <a href={directions} className="cb-primary" target="_blank" rel="noreferrer"><MapPin size={18} aria-hidden="true" />{tr('directions')}</a>}{!cancelled && <button type="button" className="cb-secondary" onClick={calendar}><CalendarPlus size={18} aria-hidden="true" />{tr('calendar')}</button>}</div>
          <footer className="bs-ticket-footer"><p>{tr('reference')} <bdi>{booking.reference}</bdi></p></footer>
        </article>}
  </main></div>;
}
