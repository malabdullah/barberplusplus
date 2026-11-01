import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, CheckCircle2, ChevronRight, Loader2, LogOut, Pencil, Plus } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { customerAuthService } from '../services/customerAuth.service';
import { GCC_COUNTRIES } from '../constants/countries';
import { validatePhoneNumber } from '../utils/validation';
import { shopWording } from '../utils/customerTerminology';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import './CustomerBooking.css';
import './CustomerAuth.css';
import './CustomerAccount.css';

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
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const arabic = i18n.language.startsWith('ar');
  const locale = arabic ? 'ar-KW' : 'en-KW';
  usePublicNavigationBusy(busy);
  useEffect(() => { document.title = `${t('customerAuth.myAccount')} | Barber++`; }, [t]);
  useEffect(() => {
    if (!customer) return undefined;
    let active = true; setListLoading(true); setListError(false);
    customerAuthService.bookings().then(data => { if (active) setBookings(data); }).catch(() => { if (active) setListError(true); }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [customer?.id, retry]);
  const edit = () => {
    setForm({ name: customer.name, email: customer.email || '', countryCode: customer.countryCode || '+965', phone: customer.phone || '' });
    setEditing(true); setSaved(false); setError('');
  };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    setError(''); setSaved(false);
    if (form.name.trim().length < 2 || form.name.trim().length > 120 || !form.email || form.email.trim().length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(form.email.trim()) || form.phone && !validatePhoneNumber(form.phone.replace(/[\s()-]/g, ''), form.countryCode).valid) { setError(tr('errors.INVALID_DETAILS')); return; }
    setBusy(true);
    try {
      const changedEmail = form.email.trim().toLowerCase() !== (customer.email || '').toLowerCase();
      await updateProfile(form); setEditing(false); setSaved(changedEmail ? 'email' : 'profile');
    } catch { setError(tr('errors.UNAVAILABLE')); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await logout(); navigate('/book', { replace: true }); }
    catch { setError(tr('errors.UNAVAILABLE')); }
    finally { setBusy(false); }
  };
  const appointmentDate = booking => new Date(`${booking.date}T${booking.time.slice(0, 5)}:00+03:00`);
  const dateOptions = { timeZone: 'Asia/Kuwait' };
  if (!loading && !customer) return <Navigate to="/customer/sign-in" state={{ returnTo: '/customer/account' }} replace />;
  return <div className="customer-booking ca-page" dir={arabic ? 'rtl' : 'ltr'}><main className="ca-main ca-account">
    {loading ? <p className="ca-loading" role="status"><Loader2 className="cb-spinner" size={24} aria-hidden="true" />{tr('loading')}</p> : <>
      <header className="ca-account-heading">
        <div><p className="ca-eyebrow">{tr('customerAccount')}</p><h1>{tr('myAccount')}</h1><p className="cb-intro">{tr('account.intro')}</p></div>
        <Link className="cb-primary" to="/book"><Plus size={18} aria-hidden="true" />{tr('bookNow')}</Link>
      </header>
      <div className="ca-account-layout">
        <section className="ca-profile-panel" aria-labelledby="profile-title">
          <header className="ca-section-heading"><h2 id="profile-title">{tr('account.profileTitle')}</h2>{!editing && <button type="button" className="cb-text-button" onClick={edit} disabled={busy}><Pencil size={16} aria-hidden="true" />{tr('editDetails')}</button>}</header>
          {error && <p className="cb-alert" role="alert" id="profile-error">{error}</p>}
          {saved && <p className="ca-profile-saved" role="status"><CheckCircle2 size={18} aria-hidden="true" />{tr(saved === 'email' ? 'email.changeSent' : 'profileSaved')}</p>}
          {editing ? <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={busy}>
            <div className="ca-profile-field"><label className="cb-field-label" htmlFor="account-name">{tr('name')}</label><input className="cb-input" id="account-name" autoComplete="name" value={form.name} maxLength={120} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /></div>
            <div className="ca-profile-field"><label className="cb-field-label" htmlFor="account-email">{tr('email.label')}</label><input className="cb-input" id="account-email" type="email" autoComplete="email" dir="ltr" value={form.email} maxLength={254} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} aria-describedby="account-email-hint" required /><p id="account-email-hint" className="cb-helper">{tr('account.emailHint')}</p></div>
            <div className="ca-profile-field"><label className="cb-field-label" htmlFor="account-phone">{tr('phone')} <span className="ca-optional">{tr('account.optional')}</span></label><div className="cb-phone-input" dir="ltr"><select aria-label={tr('countryCode')} value={form.countryCode} onChange={event => setForm(current => ({ ...current, countryCode: event.target.value }))}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.flag} {country.code}</option>)}</select><input id="account-phone" type="tel" autoComplete="tel-national" inputMode="tel" value={form.phone} maxLength={14} onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/[^0-9\s()-]/g, '') }))} /></div></div>
            <div className="ca-profile-buttons"><button type="submit" className="cb-primary" disabled={busy}>{busy && <Loader2 size={18} className="cb-spinner" aria-hidden="true" />}{tr('save')}</button><button type="button" className="cb-secondary" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>{tr('cancel')}</button></div>
          </fieldset></form> : <dl className="ca-profile-details">
            <div><dt>{tr('name')}</dt><dd>{customer.name}</dd></div>
            <div><dt>{tr('email.label')}</dt><dd><bdi>{customer.email || tr('notProvided')}</bdi></dd></div>
            <div><dt>{tr('phone')}</dt><dd><bdi>{customer.phone ? `${customer.countryCode} ${customer.phone}` : tr('notProvided')}</bdi></dd></div>
          </dl>}
          <div className="ca-profile-actions"><Link to="/customer/forgot-password">{tr('changePassword')}<ChevronRight size={18} aria-hidden="true" /></Link><button type="button" disabled={busy} onClick={signOut}>{tr('signOut')}<LogOut size={18} aria-hidden="true" /></button></div>
        </section>
        <section className="ca-appointments" aria-labelledby="appointments">
          <header className="ca-appointments-heading"><h2 id="appointments">{tr('myAppointments')}</h2><p>{tr('account.appointmentsIntro')}</p></header>
          {listLoading ? <p className="ca-appointments-state ca-loading" role="status"><Loader2 className="cb-spinner" size={22} aria-hidden="true" />{tr('loading')}</p> : listError ? <div className="cb-alert" role="alert">{tr('bookingsError')}<button type="button" onClick={() => setRetry(value => value + 1)}>{tr('retry')}</button></div> : !bookings.length ? <div className="ca-appointments-empty"><CalendarDays size={32} aria-hidden="true" /><h3>{tr('account.noAppointmentsTitle')}</h3><p>{tr('noAppointments')}</p><Link className="cb-text-button" to="/book">{tr('account.findShop')}<ChevronRight size={18} aria-hidden="true" /></Link></div> : <div className="ca-booking-list">{bookings.map(booking => {
            const date = appointmentDate(booking);
            return <article className="ca-booking-row" key={booking.id}>
              <div className="ca-booking-date" aria-hidden="true"><span>{new Intl.DateTimeFormat(locale, { month: 'short', ...dateOptions }).format(date)}</span><strong>{new Intl.DateTimeFormat(locale, { day: 'numeric', ...dateOptions }).format(date)}</strong></div>
              <div className="ca-booking-copy"><div className="ca-booking-heading"><h3>{shopWording(arabic && booking.shop_name_ar || booking.shop_name)}</h3><span className="ca-status" data-status={booking.status}>{t(`bookings.status.${booking.status === 'no_show' ? 'noShow' : booking.status}`)}</span></div>
                <p>{arabic && booking.barber_name_ar || booking.barber_name}</p><p>{(booking.services || []).map(item => arabic && item.name_ar || item.name).join(arabic ? '، ' : ', ')}</p>
                <div className="ca-booking-meta"><time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...dateOptions }).format(date)}</time><strong>{new Intl.NumberFormat(locale, { style: 'currency', currency: 'KWD' }).format(booking.price)}</strong></div>
              </div>
            </article>;
          })}<p className="ca-timezone-note">{tr('account.timezone')}</p></div>}
        </section>
      </div>
    </>}
  </main></div>;
}
