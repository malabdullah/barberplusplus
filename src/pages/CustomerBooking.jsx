import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Calendar, Check, CheckCircle2, ChevronDown, Clock, Download, Loader2, MapPin, Search, ShieldCheck, Store, UserRound } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import CustomerHeader from '../components/Customer/CustomerHeader';
import { shopWording } from '../utils/customerTerminology';
import { readBookingDraft, saveBookingDraft } from '../utils/customerBookingDraft';
import './CustomerAuth.css';
import { customerBookingService } from '../services/customerBooking.service';
import { GCC_COUNTRIES } from '../constants/countries';
import { validatePhoneNumber } from '../utils/validation';
import { addBookingDays, bookingCalendar, getBarberServices, getKuwaitDate, safeBookingUrl, searchBranches } from '../utils/customerBooking';
import './CustomerBooking.css';

const EMPTY_CATALOG = { branches: [], barbers: [], services: [] };
const SCREENS = ['location', 'appointment', 'confirm'];
const ERROR_CODES = ['INVALID_DETAILS', 'INVALID_CODE', 'VERIFICATION_REQUIRED', 'SLOT_UNAVAILABLE', 'INVALID_DATE', 'INVALID_SELECTION', 'BOOKING_UNAVAILABLE'];

function BookingImage({ src, name, person = false }) {
  const [failed, setFailed] = useState(false);
  const url = safeBookingUrl(src);
  useEffect(() => setFailed(false), [src]);
  const Fallback = person ? UserRound : Store;
  return <span className={`cb-image ${person ? 'cb-avatar' : ''}`}>
    {url && !failed ? <img src={url} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Fallback size={26} aria-hidden="true" />}
  </span>;
}

function AppointmentSection({ id, title, summary, open, onEdit, editLabel, children, disabled }) {
  return <section className={`cb-appointment-section ${open ? 'is-open' : ''}`} aria-labelledby={`${id}-title`}>
    <div className="cb-section-heading">
      <h2 id={`${id}-title`} tabIndex={-1}>{title}</h2>
      {!open && summary && <button type="button" className="cb-text-button" onClick={onEdit} disabled={disabled} aria-label={`${editLabel}: ${title}`}>{editLabel}</button>}
    </div>
    {!open && summary ? <p className="cb-section-summary"><CheckCircle2 size={18} aria-hidden="true" /><span>{summary}</span></p> : children}
  </section>;
}

export default function CustomerBooking() {
  const { t, i18n } = useTranslation();
  const { customer, refresh, loading: accountLoading } = useCustomerAuth();
  const [draft] = useState(readBookingDraft);
  const restoredDraft = useRef(false);
  const tr = (key, values) => t(`customerBooking.${key}`, values);
  const isArabic = i18n.language.startsWith('ar');
  const name = item => shopWording(isArabic && item?.nameAr ? item.nameAr : item?.name || '');
  const cityName = value => t(`customerBooking.cities.${value}`, { defaultValue: value });
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState(0);
  const [panel, setPanel] = useState('barber');
  const [city, setCity] = useState(draft?.city || '');
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState(draft?.branchId || '');
  const [barberId, setBarberId] = useState(draft?.barberId || '');
  const [serviceIds, setServiceIds] = useState(draft?.serviceIds || []);
  const [date, setDate] = useState(draft?.date || getKuwaitDate());
  const [time, setTime] = useState(draft?.time || '');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotRetry, setSlotRetry] = useState(0);
  const [slotError, setSlotError] = useState(false);
  const [details, setDetails] = useState({ name: '', countryCode: '+965', phone: '', notes: '' });
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [verification, setVerification] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const headingRef = useRef(null);
  const formRef = useRef(null);
  const codeRef = useRef(null);
  const appointmentFocusRef = useRef('');
  const cities = useMemo(() => [...new Set(catalog.branches.map(branch => branch.city).filter(Boolean))].sort(), [catalog]);
  const branch = catalog.branches.find(item => item.id === branchId);
  const barber = catalog.barbers.find(item => item.id === barberId && item.branchId === branchId);
  const branches = useMemo(() => searchBranches(catalog.branches, city, query), [catalog.branches, city, query]);
  const barbers = catalog.barbers.filter(item => item.branchId === branchId && getBarberServices(catalog, branchId, item.id).length > 0);
  const services = getBarberServices(catalog, branchId, barberId);
  const selectedServices = services.filter(item => serviceIds.includes(item.id));
  const duration = selectedServices.reduce((sum, item) => sum + item.duration, 0);
  const price = selectedServices.reduce((sum, item) => sum + item.price, 0);
  const selection = { branchId, barberId, serviceIds, date };
  const locale = isArabic ? 'ar-KW' : 'en-KW';
  const money = value => new Intl.NumberFormat(locale, { style: 'currency', currency: 'KWD' }).format(value);
  const dateLabel = value => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'Asia/Kuwait' }).format(new Date(`${value}T12:00:00+03:00`));
  const timeLabel = value => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait' }).format(new Date(`2000-01-01T${value}:00+03:00`));
  const totalLabel = `${tr('minutes', { count: duration })} · ${money(price)}`;
  const go = target => { setStep(target); setError(''); };
  const openPanel = target => { appointmentFocusRef.current = target === 'done' ? 'booking-next' : `choose-${target}-title`; setPanel(target); };
  const editAppointment = target => { openPanel(target); go(1); };
  const clearAfterBranch = () => { setBarberId(''); setServiceIds([]); setTime(''); setSlots([]); setPanel('barber'); };
  const changeCity = value => { setCity(value); setBranchId(''); setQuery(''); clearAfterBranch(); setError(''); };
  const selectBranch = id => { if (id !== branchId) { setBranchId(id); clearAfterBranch(); } };
  const selectBarber = id => {
    if (id !== barberId) { setBarberId(id); setServiceIds([]); setTime(''); setSlots([]); }
    openPanel('services'); setError('');
  };
  const toggleService = id => {
    setServiceIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setTime(''); setSlots([]); setError('');
  };
  const errorText = value => tr(`errors.${ERROR_CODES.includes(value) ? value : 'UNAVAILABLE'}`);

  useEffect(() => {
    if (customer) { setDetails(current => ({ ...current, name: customer.name, countryCode: customer.countryCode, phone: customer.phone })); setChallenge(null); setVerification(''); }
  }, [customer?.id, customer?.name, customer?.phone]);
  useEffect(() => {
    if (catalogLoading || catalogError || restoredDraft.current) return;
    restoredDraft.current = true;
    if (!draft || !branch || branch.city !== city) { if (draft) { setBranchId(''); clearAfterBranch(); } return; }
    const valid = barber && serviceIds.length && selectedServices.length === serviceIds.length && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getKuwaitDate() && date <= addBookingDays(getKuwaitDate(), barber.maxBookingDays || 30) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (valid) { setPanel('done'); setStep(draft.step); }
    else { clearAfterBranch(); setStep(Math.min(draft.step, 1)); }
  }, [catalogLoading, catalogError, catalog]);
  useEffect(() => { if (receipt) saveBookingDraft(null); else if (city) saveBookingDraft({ city, branchId, barberId, serviceIds, date, time, step }); }, [city, branchId, barberId, serviceIds, date, time, step, receipt]);
  useEffect(() => {
    const previous = document.title;
    document.title = t('customerBooking.pageTitle');
    return () => { document.title = previous; };
  }, [t]);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true); setCatalogError(false); setError('');
    customerBookingService.getCatalog().then(data => { if (active) setCatalog(data); })
      .catch(() => { if (active) { setError('UNAVAILABLE'); setCatalogError(true); } })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step, receipt]);
  useEffect(() => {
    if (step !== 1 || !appointmentFocusRef.current) return;
    const target = document.getElementById(appointmentFocusRef.current);
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'nearest' }); appointmentFocusRef.current = ''; }
  }, [panel, step]);
  useEffect(() => { if (challenge && !verification) codeRef.current?.focus(); }, [challenge, verification]);
  const serviceKey = serviceIds.join(',');
  useEffect(() => {
    if (step !== 1 || !barberId || !serviceKey || !date) return undefined;
    let active = true;
    setSlotsLoading(true); setSlots([]); setSlotError(false);
    customerBookingService.getSlots({ branchId, barberId, serviceIds: serviceKey.split(','), date })
      .then(result => { if (active) { setSlots(result.slots); setTime(current => result.slots.includes(current) ? current : ''); } })
      .catch(failure => { if (active) { setError(failure.message); setSlotError(true); setTime(''); } })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [step, branchId, barberId, serviceKey, date, slotRetry]);

  const requestCode = async () => {
    const errors = {};
    if (details.name.trim().length < 2 || details.name.trim().length > 120) errors.name = tr('nameError');
    if (!validatePhoneNumber(details.phone.replace(/[\s()-]/g, ''), details.countryCode).valid) errors.phone = tr('phoneError');
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setTimeout(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setBusy(true); setError('');
    try { setChallenge(await customerBookingService.requestCode(details)); setCode(''); setVerification(''); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const confirmBooking = async event => {
    event.preventDefault();
    if (busy) return;
    if (!challenge && !customer) { await requestCode(); return; }
    if (!customer && !verification && !/^\d{6}$/.test(code)) { setError('INVALID_CODE'); codeRef.current?.focus(); return; }
    setBusy(true); setError('');
    try {
      // Preserve the same verified booking ID across uncertain network retries.
      const proof = verification || (customer ? await customerBookingService.accountProof() : await customerBookingService.verifyCode({ challenge: challenge.challenge, code })).verification;
      setVerification(proof);
      setReceipt(await customerBookingService.book({ ...selection, time, verification: proof, notes: details.notes }));
    } catch (failure) {
      setError(failure.message);
      if (failure.message === 'INVALID_CODE') codeRef.current?.focus();
      if (failure.message === 'SLOT_UNAVAILABLE') { setTime(''); setPanel('time'); setStep(1); setSlotRetry(value => value + 1); }
      if (failure.message === 'VERIFICATION_REQUIRED') { setVerification(''); setChallenge(null); if (customer) await refresh(); }
    } finally { setBusy(false); }
  };
  const editDetails = () => { setChallenge(null); setVerification(''); setCode(''); setError(''); };
  const appointmentReady = Boolean(branch && barber && selectedServices.length && time && !slotsLoading && !slotError);
  const canContinue = step === 0 ? Boolean(city && branch && !catalogError) : step === 1 ? appointmentReady : Boolean(!accountLoading && (customer || verification || !challenge || code.length === 6));
  const nextLabel = step === 0 ? tr('three.nextAppointment') : step === 1 ? tr('three.nextConfirm') : tr(customer || verification ? 'confirm' : !challenge ? 'three.sendCode' : 'three.verifyConfirm');
  const title = receipt ? tr('successTitle') : tr(`three.titles.${SCREENS[step]}`);
  const downloadCalendar = () => {
    const url = URL.createObjectURL(new Blob([bookingCalendar(receipt)], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `barber-${receipt.reference}.ics`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renderSummary = (data = null) => <dl className="cb-review-list">
    <div><dt>{tr('steps.branch')}</dt><dd>{data ? (isArabic && data.branchNameAr || data.branchName) : name(branch)}{!data && <button type="button" onClick={() => go(0)} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.branch')}`}>{tr('edit')}</button>}</dd></div>
    <div><dt>{tr('steps.barber')}</dt><dd>{data ? (isArabic && data.barberNameAr || data.barberName) : name(barber)}{!data && <button type="button" onClick={() => editAppointment('barber')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.barber')}`}>{tr('edit')}</button>}</dd></div>
    <div><dt>{tr('steps.services')}</dt><dd>{(data?.services || selectedServices).map(name).join(isArabic ? '، ' : ', ')}{!data && <button type="button" onClick={() => editAppointment('services')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.services')}`}>{tr('edit')}</button>}</dd></div>
    <div><dt>{tr('steps.time')}</dt><dd>{dateLabel(data?.date || date)}<br />{timeLabel(data?.time || time)} · {tr('minutes', { count: data?.duration || duration })}{!data && <button type="button" onClick={() => editAppointment('time')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.time')}`}>{tr('edit')}</button>}</dd></div>
    <div className="cb-total"><dt>{tr('total')}</dt><dd>{money(data?.price ?? price)}</dd></div>
  </dl>;

  return <div className="customer-booking" dir={isArabic ? 'rtl' : 'ltr'}>
    <CustomerHeader busy={busy} />
    <div className="cb-layout">
      <aside className="cb-sidebar" aria-label={tr('progress')}>
        <ol>{SCREENS.map((key, index) => <li key={key} className={`${step === index && !receipt ? 'current' : ''} ${index < step || receipt ? 'complete' : ''}`} aria-current={step === index && !receipt ? 'step' : undefined}>
          <span className="cb-step-dot">{index < step || receipt ? <Check size={14} aria-hidden="true" /> : null}</span>
          <div><button type="button" disabled={index >= step || busy || Boolean(receipt)} onClick={() => go(index)}>{tr(`three.steps.${key}`)}</button><p>{index === 0 && branch ? name(branch) : index === 1 && time ? `${name(barber)} · ${timeLabel(time)}` : tr(`three.hints.${key}`)}</p></div>
        </li>)}</ol>
      </aside>
      <main className="cb-main" id="booking-content">
        {!receipt && <div className="cb-mobile-progress">
          <div>{step > 0 ? <button type="button" onClick={() => go(step - 1)} aria-label={tr('back')} disabled={busy}><ArrowLeft size={22} className="cb-directional" /></button> : <span />}
            <span>{tr('stepOf', { current: step + 1, total: SCREENS.length })} · <strong>{tr(`three.steps.${SCREENS[step]}`)}</strong></span></div>
          <ol aria-label={tr('progress')}>{SCREENS.map((key, index) => <li key={key} className={index <= step ? 'active' : ''} aria-current={step === index ? 'step' : undefined}><span className="sr-only">{tr(`three.steps.${key}`)}</span></li>)}</ol>
        </div>}
        {!receipt && step > 0 && <div className="cb-context"><MapPin size={18} aria-hidden="true" /><span>{name(branch)} · {cityName(city)}</span><button type="button" onClick={() => go(0)} disabled={busy}>{tr('change')}</button></div>}
        {receipt && <CheckCircle2 size={46} className="cb-success-icon" aria-hidden="true" />}
        <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
        <p className="cb-intro">{receipt ? tr('successIntro') : tr(`three.intros.${SCREENS[step]}`)}</p>
        {error && <div className="cb-alert" role="alert"><span>{errorText(error)}</span>{(catalogError || slotError) && <button type="button" disabled={busy} onClick={() => { setError(''); if (catalogError) setReload(value => value + 1); else setSlotRetry(value => value + 1); }}>{tr('retry')}</button>}</div>}
        {catalogLoading ? <div className="cb-loading" role="status"><Loader2 size={22} className="cb-spinner" />{tr('loading')}</div> : receipt ? <div className="cb-success">
          <div className="cb-reference"><ShieldCheck size={20} aria-hidden="true" /><span>{tr('reference')} <strong dir="ltr">{receipt.reference}</strong></span></div>
          {renderSummary(receipt)}
          <p className="cb-payment"><Store size={20} aria-hidden="true" /><span>{tr('payAtShop')}</span></p>
          <div className="cb-success-actions"><button type="button" className="cb-primary" onClick={downloadCalendar}><Download size={18} />{tr('addCalendar')}</button>{safeBookingUrl(receipt.locationUrl) && <a className="cb-secondary" href={safeBookingUrl(receipt.locationUrl)} target="_blank" rel="noreferrer">{tr('directions')}</a>}<button type="button" className="cb-text-button" onClick={() => window.location.reload()}>{tr('anotherBooking')}</button></div>
        </div> : <>
          {step === 0 && <>
            <div className="cb-city-step"><label className="cb-field-label" htmlFor="booking-city">{tr('cityLabel')}</label><div className="cb-select-wrap"><MapPin size={20} aria-hidden="true" /><select id="booking-city" value={city} onChange={event => changeCity(event.target.value)}><option value="">{tr('cityPlaceholder')}</option>{cities.map(value => <option key={value} value={value}>{cityName(value)}</option>)}</select><ChevronDown size={18} aria-hidden="true" /></div>{cities.length === 0 && !error && <p className="cb-empty">{tr('noCities')}</p>}{!city && <p className="cb-helper">{tr('cityHint')}</p>}</div>
            {city && <div className="cb-branch-results">
              <label className="cb-field-label" htmlFor="branch-search">{tr('searchLabel')}</label><div className="cb-search"><Search size={23} aria-hidden="true" /><input id="branch-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tr('searchPlaceholder')} /></div><p className="cb-result-count" aria-live="polite">{tr('branchesCount', { count: branches.length })}</p>
              <fieldset className="cb-options"><legend className="sr-only">{tr('titles.branch')}</legend>{branches.map(item => <label key={item.id} className={`cb-option ${branchId === item.id ? 'selected' : ''}`}><input type="radio" name="branch" value={item.id} checked={branchId === item.id} onChange={() => selectBranch(item.id)} /><BookingImage src={item.logoUrl} name={name(item)} /><span className="cb-option-copy"><strong>{name(item)}</strong><span>{(isArabic ? item.areaAr : item.area) || item.address || item.city}</span></span><span className="cb-radio" aria-hidden="true">{branchId === item.id && <Check size={17} />}</span></label>)}</fieldset>
              {branches.length === 0 && <div className="cb-empty"><Store size={28} aria-hidden="true" /><h2>{tr('noBranches')}</h2><p>{tr('noBranchesHint')}</p>{query && <button type="button" className="cb-text-button" onClick={() => setQuery('')}>{tr('clearSearch')}</button>}</div>}
            </div>}
          </>}
          {step === 1 && <div className="cb-appointment">
            <AppointmentSection id="choose-barber" title={tr('titles.barber')} summary={name(barber)} open={panel === 'barber' || !barber} onEdit={() => openPanel('barber')} editLabel={tr('edit')}>
              <fieldset className="cb-options"><legend className="sr-only">{tr('titles.barber')}</legend>{barbers.map(item => <label key={item.id} className={`cb-option ${barberId === item.id ? 'selected' : ''}`}><input type="radio" name="barber" checked={barberId === item.id} onClick={() => { if (barberId === item.id) openPanel('services'); }} onChange={() => selectBarber(item.id)} /><BookingImage src={item.avatarUrl} name={name(item)} person /><span className="cb-option-copy"><strong>{name(item)}</strong><span>{tr('servicesCount', { count: getBarberServices(catalog, branchId, item.id).length })}</span></span><span className="cb-radio" aria-hidden="true">{barberId === item.id && <Check size={17} />}</span></label>)}</fieldset>
              {!barbers.length && <div className="cb-empty"><UserRound size={28} /><h2>{tr('noBarbers')}</h2><p>{tr('noBarbersHint')}</p><button type="button" className="cb-text-button" onClick={() => go(0)}>{tr('changeBranch')}</button></div>}
            </AppointmentSection>
            {barber && panel !== 'barber' && <>
              <AppointmentSection id="choose-services" title={tr('steps.services')} summary={selectedServices.map(name).join(isArabic ? '، ' : ', ')} open={panel === 'services' || !selectedServices.length} onEdit={() => openPanel('services')} editLabel={tr('edit')}>
                <fieldset className="cb-options"><legend className="sr-only">{tr('titles.services')}</legend>{services.map(item => <label key={item.id} className={`cb-option cb-service ${serviceIds.includes(item.id) ? 'selected' : ''}`}><input type="checkbox" checked={serviceIds.includes(item.id)} onChange={() => toggleService(item.id)} /><span className="cb-option-copy"><strong>{name(item)}</strong><span>{tr('minutes', { count: item.duration })}</span></span><strong className="cb-service-price">{money(item.price)}</strong><span className="cb-radio cb-checkbox" aria-hidden="true">{serviceIds.includes(item.id) && <Check size={17} />}</span></label>)}</fieldset>
                <p className="cb-helper"><Clock size={17} aria-hidden="true" />{tr('serviceHint')}</p>
              </AppointmentSection>
              {selectedServices.length > 0 && <AppointmentSection id="choose-time" title={tr('steps.time')} summary={time ? `${dateLabel(date)} · ${timeLabel(time)}` : ''} open={panel !== 'done' || !time} onEdit={() => openPanel('time')} editLabel={tr('edit')}>
                <label htmlFor="booking-date" className="cb-field-label">{tr('dateLabel')}</label><input className="cb-input cb-date" id="booking-date" type="date" value={date} min={getKuwaitDate()} max={addBookingDays(getKuwaitDate(), barber.maxBookingDays || 30)} onChange={event => { setDate(event.target.value); setTime(''); setPanel('time'); setError(''); }} required /><p className="cb-helper">{tr('kuwaitTime')}</p><h3 className="cb-time-heading">{tr('timeLabel')}</h3>
                {slotsLoading ? <p className="cb-loading" role="status"><Loader2 size={20} className="cb-spinner" />{tr('loadingTimes')}</p> : <fieldset className="cb-time-options"><legend className="sr-only">{tr('timeLabel')}</legend>{slots.map(slot => <label key={slot} className={time === slot ? 'selected' : ''}><input type="radio" name="time" checked={time === slot} onChange={() => { setTime(slot); openPanel('done'); setError(''); }} /><span>{timeLabel(slot)}</span>{time === slot && <Check size={15} aria-hidden="true" />}</label>)}</fieldset>}
                {!slotsLoading && !slots.length && !slotError && <div className="cb-empty"><Calendar size={28} aria-hidden="true" /><h3>{tr('noTimes')}</h3><p>{tr('noTimesHint')}</p></div>}
              </AppointmentSection>}
            </>}
          </div>}
          {step === 2 && <>
            <section className="cb-confirm-summary" aria-label={tr('three.bookingSummary')}>{renderSummary()}</section>
            <form ref={formRef} className="cb-details" onSubmit={confirmBooking} id="booking-confirm-form" noValidate>
              <fieldset className="cb-details-fields" disabled={busy}>
                {customer ? <>
                  <div className="cb-verified-details"><div><strong>{customer.name}</strong><br /><bdi>{customer.countryCode} {customer.phone}</bdi></div><Link to="/customer/account">{t('customerAuth.manageAccount')}</Link></div><p className="cb-helper">{t('customerAuth.accountDetails')}</p>
                  <label htmlFor="booking-notes" className="cb-field-label">{tr('notesLabel')}</label><textarea id="booking-notes" className="cb-input" rows={2} maxLength={500} value={details.notes} onChange={event => setDetails(current => ({ ...current, notes: event.target.value }))} />
                </> : !challenge ? <>
                  <h2 className="cb-section-title">{tr('yourDetails')}</h2>
                  <label className="cb-field-label" htmlFor="customer-name">{tr('nameLabel')}</label><input id="customer-name" className="cb-input" autoComplete="name" value={details.name} maxLength={120} onChange={event => { setDetails(current => ({ ...current, name: event.target.value })); setFieldErrors(current => ({ ...current, name: '' })); }} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'customer-name-error' : undefined} required />{fieldErrors.name && <p className="cb-field-error" id="customer-name-error">{fieldErrors.name}</p>}
                  <label className="cb-field-label" htmlFor="customer-phone">{tr('phoneLabel')}</label><div className="cb-phone-input" dir="ltr"><select aria-label={tr('countryCode')} value={details.countryCode} onChange={event => { setDetails(current => ({ ...current, countryCode: event.target.value })); setFieldErrors(current => ({ ...current, phone: '' })); }}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.code}</option>)}</select><input id="customer-phone" type="tel" autoComplete="tel-national" value={details.phone} maxLength={14} onChange={event => { setDetails(current => ({ ...current, phone: event.target.value.replace(/[^0-9\s()-]/g, '') })); setFieldErrors(current => ({ ...current, phone: '' })); }} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'customer-phone-error' : undefined} required /></div>{fieldErrors.phone && <p className="cb-field-error" id="customer-phone-error">{fieldErrors.phone}</p>}
                  <label htmlFor="booking-notes" className="cb-field-label">{tr('notesLabel')}</label><textarea id="booking-notes" className="cb-input" rows={2} maxLength={500} value={details.notes} onChange={event => setDetails(current => ({ ...current, notes: event.target.value }))} /><p className="cb-helper">{tr('noAccount')}</p>
                </> : <>
                  <div className="cb-verified-details"><div><strong>{details.name}</strong><br /><bdi>{details.countryCode} {details.phone}</bdi></div><button type="button" className="cb-text-button" onClick={editDetails}>{tr('change')}</button></div>
                  {!verification && <>
                    <h2 className="cb-section-title">{tr('verifyTitle')}</h2><div className="cb-test-code"><ShieldCheck size={20} aria-hidden="true" /><div><strong>{tr('testCode', { code: challenge.testCode })}</strong><p>{tr('noSms')}</p></div></div>
                    <label className="cb-field-label" htmlFor="booking-code">{tr('verificationCode')}</label><input ref={codeRef} className="cb-input cb-code-input" id="booking-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required />
                    <button className="cb-text-button" type="button" onClick={requestCode}>{tr('resendCode')}</button><p className="cb-helper">{tr('codeExpires')}</p>
                  </>}
                  {verification && <p className="cb-helper"><ShieldCheck size={18} aria-hidden="true" />{tr('three.numberVerified')}</p>}
                </>}
              </fieldset>
            </form>
            <p className="cb-payment"><Store size={20} aria-hidden="true" /><span>{tr('payAtShop')}</span></p>
          </>}
        </>}
        {!catalogLoading && !receipt && <footer className="cb-actions">
          <div className="cb-action-context" aria-live="polite">{step === 0 ? branch ? tr('branchSelected', { name: name(branch) }) : cityName(city) : selectedServices.length ? totalLabel : name(branch)}</div>
          <div className="cb-action-buttons">
            {step > 0 && <button type="button" className="cb-back" onClick={() => go(step - 1)} disabled={busy}><ArrowLeft size={18} className="cb-directional" />{tr('back')}</button>}
            <button id="booking-next" type={step === 2 ? 'submit' : 'button'} form={step === 2 ? 'booking-confirm-form' : undefined} className="cb-primary" disabled={!canContinue || busy} onClick={step < 2 ? () => go(step + 1) : undefined}>{busy && <Loader2 size={19} className="cb-spinner" />}{busy ? tr('working') : nextLabel}{!busy && <ArrowRight size={20} className="cb-directional" />}</button>
          </div>
        </footer>}
      </main>
    </div>
  </div>;
}
