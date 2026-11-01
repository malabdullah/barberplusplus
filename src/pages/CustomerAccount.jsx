import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { GCC_COUNTRIES } from '../constants/countries';
import { validatePhoneNumber } from '../utils/validation';
import { shopWording } from '../utils/customerTerminology';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import './CustomerBooking.css';
import './CustomerAuth.css';
export default function CustomerAccount() {
  const { t, i18n } = useTranslation();
  const tr = key => t(`customerAuth.${key}`);
  const { customer, loading, logout, updateProfile } = useCustomerAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', countryCode: '+965', phone: '' });
  const [busy, setBusy] = useState(false);
  usePublicNavigationBusy(busy);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const arabic = i18n.language.startsWith('ar');
  useEffect(() => { document.title = `${t('customerAuth.myAccount')} | Barber++`; }, [t]);
  useEffect(() => {
    if (!customer) return undefined;
    let active = true; setListLoading(true); setListError(false);
    customerAuthService.bookings().then(data => { if (active) setBookings(data); }).catch(() => { if (active) setListError(true); }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [customer?.id, retry]);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    if (form.name.trim().length < 2 || form.name.trim().length > 120 || (!form.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(form.email.trim())) || form.phone && !validatePhoneNumber(form.phone.replace(/[\s()-]/g, ''), form.countryCode).valid) { setError(tr('errors.INVALID_DETAILS')); setBusy(false); return; }
    try { const changedEmail = form.email.trim().toLowerCase() !== (customer.email || '').toLowerCase(); await updateProfile(form); setEditing(false); setSaved(changedEmail ? 'email' : 'profile'); }
    catch { setError(tr('errors.UNAVAILABLE')); }
    finally { setBusy(false); }
  };
  const signOut = async () => { setBusy(true); setError(''); try { await logout(); navigate('/book', { replace: true }); } catch { setError(tr('errors.UNAVAILABLE')); } finally { setBusy(false); } };
  if (!loading && !customer) return <Navigate to="/customer/sign-in" state={{ returnTo: '/customer/account' }} replace />;
  return <div className="customer-booking ca-page" dir={arabic ? 'rtl' : 'ltr'}><main className="ca-main ca-account">
    {loading ? <p role="status"><Loader2 className="cb-spinner" />{tr('loading')}</p> : <>
      <div className="ca-account-heading"><h1>{tr('myAccount')}</h1><Link className="cb-primary" to="/book">{tr('bookNow')}</Link></div>
      {error && <p className="cb-alert" role="alert">{error}</p>}{saved && <p role="status">{tr(saved === 'email' ? 'email.changeSent' : 'profileSaved')}</p>}
      {editing ? <form onSubmit={submit}><fieldset className="cb-details-fields" disabled={busy}><label className="cb-field-label" htmlFor="account-name">{tr('name')}</label><input className="cb-input" id="account-name" value={form.name} maxLength={120} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /><label className="cb-field-label" htmlFor="account-email">{tr('email.label')}</label><input className="cb-input" id="account-email" type="email" value={form.email} maxLength={254} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /><label className="cb-field-label" htmlFor="account-phone">{tr('phone')}</label><div className="cb-phone-input" dir="ltr"><select aria-label={tr('countryCode')} value={form.countryCode} onChange={event => setForm(current => ({ ...current, countryCode: event.target.value }))}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.code}</option>)}</select><input id="account-phone" type="tel" value={form.phone} maxLength={14} onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/[^0-9\s()-]/g, '') }))} /></div><button type="submit" className="cb-primary ca-submit">{tr('save')}</button><button type="button" className="cb-text-button" onClick={() => setEditing(false)}>{tr('cancel')}</button></fieldset></form> : <>
        <dl><div><dt>{tr('name')}</dt><dd>{customer.name}</dd></div><div><dt>{tr('phone')}</dt><dd><bdi>{customer.phone ? `${customer.countryCode} ${customer.phone}` : tr('notProvided')}</bdi></dd></div><div><dt>{tr('email.label')}</dt><dd>{customer.email || tr('notProvided')}</dd></div></dl>
        <div className="ca-account-actions"><button type="button" className="cb-text-button" onClick={() => { setForm({ name: customer.name, email: customer.email || '', countryCode: customer.countryCode || '+965', phone: customer.phone || '' }); setEditing(true); setSaved(false); }}>{tr('editDetails')}</button><Link className="cb-text-button" to="/customer/forgot-password">{tr('changePassword')}</Link><button type="button" className="cb-text-button" disabled={busy} onClick={signOut}>{tr('signOut')}</button></div>
      </>}
      <h2 id="appointments">{tr('myAppointments')}</h2>
      {listLoading ? <p role="status">{tr('loading')}</p> : listError ? <div className="cb-alert" role="alert">{tr('bookingsError')}<button type="button" onClick={() => setRetry(value => value + 1)}>{tr('retry')}</button></div> : !bookings.length ? <p className="ca-empty">{tr('noAppointments')}</p> : bookings.map(booking => <article className="ca-booking-row" key={booking.id}>
        <h3>{shopWording(arabic && booking.shop_name_ar || booking.shop_name)}</h3><p>{arabic && booking.barber_name_ar || booking.barber_name} · {(booking.services || []).map(item => arabic && item.name_ar || item.name).join(arabic ? '، ' : ', ')}</p>
        <p>{new Intl.DateTimeFormat(arabic ? 'ar-KW' : 'en-KW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(`${booking.date}T${booking.time}:00+03:00`))}</p><p>{new Intl.NumberFormat(arabic ? 'ar-KW' : 'en-KW', { style: 'currency', currency: 'KWD' }).format(booking.price)}</p><span className="ca-status">{t(`bookings.status.${booking.status === 'no_show' ? 'noShow' : booking.status}`)}</span>
      </article>)}
    </>}
  </main></div>;
}
