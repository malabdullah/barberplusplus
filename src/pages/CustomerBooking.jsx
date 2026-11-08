import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Calendar, Check, CheckCircle2, Clock, Download, Loader2, Search, ShieldCheck, Store, UserRound } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { useCustomerFavourites } from '../context/CustomerFavouritesContext';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import { shopWording } from '../utils/customerTerminology';
import { readBookingDraft, readBookingReturnDraft, saveBookingDraft, readBookingReceipt, saveBookingReceipt, rememberBookingReturn, forgetBookingReturn } from '../utils/customerBookingDraft';
import './CustomerAuth.css';
import { customerBookingService } from '../services/customerBooking.service';
import { GCC_COUNTRIES } from '../constants/countries';
import { bookingCityGroups } from '../utils/bookingCityGroups';
import BookingFinder from '../components/Customer/BookingFinder';
import CityPicker from '../components/Customer/CityPicker';
import CatalogRating from '../components/Customer/CatalogRating';
import BookingImage from '../components/Customer/BookingImage';
import FavouriteButton from '../components/Customer/FavouriteButton';
import FavouriteFeedback from '../components/Customer/FavouriteFeedback';
import { validatePhoneNumber } from '../utils/validation';
import { addBookingDays, downloadBookingCalendar, getBarberServices, getKuwaitDate, safeBookingUrl, searchBranches } from '../utils/customerBooking';
import './CustomerBooking.css';

const EMPTY_CATALOG = { branches: [], barbers: [], services: [] };
const PANELS = ['city', 'shop', 'barber', 'services', 'time', 'details'];
const ERROR_CODES = ['SELF_BOOKING_NOT_ALLOWED', 'INVALID_DETAILS', 'INVALID_CODE', 'VERIFICATION_REQUIRED', 'SLOT_UNAVAILABLE', 'INVALID_DATE', 'INVALID_SELECTION', 'BOOKING_UNAVAILABLE', 'BOOKING_POLICY_CHANGED', 'PHONE_IN_USE', 'PHONE_TEST_NUMBER', 'PHONE_RATE_LIMIT', 'PHONE_UNAVAILABLE', 'PHONE_CHANGED'];


function BookingSection({ id, title, summary, open, onEdit, onDone, editLabel, doneLabel, feedback, children, disabled }) {
  return <section id={id} className={`cb-appointment-section ${open ? 'is-open' : ''} ${!open && !summary ? 'is-pending' : ''}`} aria-labelledby={`${id}-title`} data-booking-section={id}>
    <div className="cb-section-heading">
      <h2 id={`${id}-title`} tabIndex={-1}>{title}</h2>
      {!open && summary && <button type="button" className="cb-text-button" onClick={onEdit} disabled={disabled} aria-label={`${editLabel}: ${title}`} aria-expanded={false} aria-controls={`${id}-content`}>{editLabel}</button>}
      {open && summary && onDone && <button type="button" className="cb-text-button" onClick={onDone} disabled={disabled} aria-expanded={true} aria-controls={`${id}-content`}>{doneLabel}</button>}
    </div>
    {!open && summary && <p className="cb-section-summary"><CheckCircle2 size={18} aria-hidden="true" /><span>{summary}</span></p>}
    <div id={`${id}-content`} hidden={!open}>{feedback}{children}</div>
  </section>;
}

function favouritesFirst(options, favourites, kind) {
  const saved = new Set(favourites.filter(item => item.kind === kind).map(item => item.targetId));
  return [...options].sort((a, b) => Number(saved.has(b.id)) - Number(saved.has(a.id)));
}

export function CustomerBookingCheckout({ initialDraft, scopedCatalog, onEditProvider }) {
  const { t, i18n } = useTranslation();
  const { customer, refresh, updateProfile, loading: accountPending, error: accountError } = useCustomerAuth();
  const accountLoading = accountPending || accountError;
  const { items: favourites } = useCustomerFavourites();
  const location = useLocation();
  const navigate = useNavigate();
  const [returnDraft] = useState(readBookingReturnDraft);
  const [draft] = useState(() => initialDraft || location.state?.bookingDraft || location.state?.rebookingDraft || returnDraft || readBookingDraft());
  const [rebookNotice, setRebookNotice] = useState(draft?.rebookNotice || '');
  const restoredDraft = useRef(false);
  const tr = (key, values) => t(`customerBooking.${key}`, values);
  const isArabic = i18n.language.startsWith('ar');
  const name = item => shopWording(isArabic && item?.nameAr ? item.nameAr : item?.name || '');
  const cityName = value => t(`customerBooking.cities.${value}`, {
    defaultValue: (isArabic && catalog.branches.find(item => item.city === value)?.cityAr) || value,
  });
  const [catalog, setCatalog] = useState(scopedCatalog || EMPTY_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(!scopedCatalog);
  const [catalogError, setCatalogError] = useState(false);
  const [reload, setReload] = useState(0);
  const [panel, setPanel] = useState('city');
  const [draftRestored, setDraftRestored] = useState(!draft);
  const [city, setCity] = useState(draft?.city || '');
  const [query, setQuery] = useState(() => typeof draft?.query === 'string' ? draft.query : '');
  const [branchId, setBranchId] = useState(draft?.branchId || '');
  const [barberId, setBarberId] = useState(draft?.barberId || '');
  const [serviceIds, setServiceIds] = useState(draft?.serviceIds || []);
  const [date, setDate] = useState(draft?.date || getKuwaitDate());
  const [time, setTime] = useState(draft?.time || '');
  const [slots, setSlots] = useState([]);
  const [bookingPolicy, setBookingPolicy] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotRetry, setSlotRetry] = useState(0);
  const [slotError, setSlotError] = useState(false);
  const [details, setDetails] = useState(() => ({ name: '', countryCode: '+965', phone: '', notes: '', ...draft?.details }));
  const [verification, setVerification] = useState('');
  const [phoneConfig, setPhoneConfig] = useState(null);
  const [accountPhoneCheck, setAccountPhoneCheck] = useState(null);
  const [phoneSession, setPhoneSession] = useState(null);
  const [phoneChallenge, setPhoneChallenge] = useState(null);
  const phoneChallengeRef = useRef(null);
  const [phoneCode, setPhoneCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const captchaRef = useRef(null);
  const phoneCodeRef = useRef(null);
  useEffect(() => () => phoneChallengeRef.current?.abort(), []);
  const [receipt, setReceipt] = useState(() => (location.state?.bookingDraft || location.state?.rebookingDraft || returnDraft) ? null : readBookingReceipt());
  const [guest, setGuest] = useState(draft?.guest === true);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [busy, setBusy] = useState(false);
  usePublicNavigationBusy(busy);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const headingRef = useRef(null);
  const formRef = useRef(null);
  const appointmentFocusRef = useRef('');
  const cities = useMemo(() => [...new Set(catalog.branches.map(branch => branch.city).filter(Boolean))].sort(), [catalog]);
  const cityGroups = useMemo(() => bookingCityGroups(catalog.branches), [catalog.branches]);
  const governorateName = group => group.key === 'other' ? tr('otherLocations') : tr(`governorates.${group.key}`, { defaultValue: isArabic && group.nameAr ? group.nameAr : group.name });
  const branch = catalog.branches.find(item => item.id === branchId);
  const bookableBarbers = catalog.barbers.filter(item => !customer?.ownBarberIds?.includes(item.id));
  const barber = bookableBarbers.find(item => item.id === barberId && item.branchId === branchId && getBarberServices(catalog, branchId, item.id).length);
  const branches = useMemo(() => favouritesFirst(searchBranches(catalog.branches, city, query), favourites, 'shop'), [catalog.branches, city, query, favourites]);
  const ownShopProfile = catalog.barbers.some(item => item.branchId === branchId && customer?.ownBarberIds?.includes(item.id));
  const eligibleBarbers = bookableBarbers.filter(item => item.branchId === branchId && getBarberServices(catalog, branchId, item.id).length > 0);
  const barbers = favouritesFirst(eligibleBarbers, favourites, 'barber');
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
  const openPanel = target => {
    appointmentFocusRef.current = `choose-${target}-title`;
    setPanel(target);
  };
  const currentDraft = () => ({ ...draft, city, branchId, barberId, serviceIds, date, time, panel, details, guest, step: Math.floor(PANELS.indexOf(panel) / 2) });
  const editSection = target => {
    setError('');
    if (onEditProvider && ['city', 'shop', 'barber', 'range'].includes(target)) onEditProvider(target, currentDraft());
    else openPanel(target);
  };
  const clearAfterBranch = () => { setBarberId(''); setServiceIds([]); setTime(''); setSlots([]); };
  const changeCity = value => {
    if (value !== city) { setCity(value); setBranchId(''); setQuery(''); clearAfterBranch(); }
    openPanel(value ? 'shop' : 'city'); setError(''); setRebookNotice('');
  };
  const selectBranch = id => {
    if (id !== branchId) { setBranchId(id); clearAfterBranch(); }
    openPanel('barber'); setError(''); setRebookNotice('');
  };
  const selectBarber = id => {
    if (id !== barberId) { setBarberId(id); setServiceIds([]); setTime(''); setSlots([]); }
    openPanel('services'); setError(''); setRebookNotice('');
  };
  const toggleService = id => {
    setServiceIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setTime(''); setSlots([]); setError('');
  };
  const errorText = value => tr(`errors.${ERROR_CODES.includes(value) ? value : 'UNAVAILABLE'}`);

  const recoverUnavailableSelection = async (isCurrent = () => true) => {
    try {
      const latest = scopedCatalog ? await customerBookingService.selection({ barberId, mode: draft?.bookingMode || 'shop', date, rangeStart: draft?.rangeStart, rangeEnd: draft?.rangeEnd }) : await customerBookingService.getCatalog();
      if (!isCurrent()) return;
      setCatalog(latest);
      setTime('');
      setSlots([]);
      const shop = latest.branches.find(item => item.id === branchId && item.city === city);
      if (!shop) {
        setBranchId('');
        clearAfterBranch();
        const cityStillAvailable = latest.branches.some(item => item.city === city);
        if (!cityStillAvailable) { setCity(''); setQuery(''); }
        openPanel(cityStillAvailable ? 'shop' : 'city');
      } else {
        const remainingServices = getBarberServices(latest, branchId, barberId);
        if (!remainingServices.length) {
          clearAfterBranch();
          openPanel('barber');
        } else {
          setServiceIds(current => current.filter(id => remainingServices.some(service => service.id === id)));
          openPanel('services');
        }
      }
    } catch {
      if (!isCurrent()) return;
      setTime('');
      setSlotError(true);
      openPanel('time');
    }
  };

  useEffect(() => {
    if (returnDraft && draft === returnDraft) { saveBookingDraft(returnDraft); saveBookingReceipt(null); }
    forgetBookingReturn();
    if (location.state?.bookingDraft || location.state?.rebookingDraft) { saveBookingReceipt(null); navigate(location.pathname, { replace: true, state: null }); }
  }, []);
  useEffect(() => {
    if (customer) { setDetails(current => ({ ...current, name: customer.name, countryCode: customer.countryCode || '+965', phone: customer.phone || '' })); setVerification(''); }
  }, [customer?.id, customer?.name, customer?.phone]);
  useEffect(() => {
    if (catalogLoading || catalogError || restoredDraft.current) return;
    restoredDraft.current = true;
    if (!draft) return;
    setDraftRestored(true);
    if (!cities.includes(city)) { setCity(''); setBranchId(''); clearAfterBranch(); if (draft.rebooking || draft.favourite) setRebookNotice('shopUnavailable'); return; }
    if (!branch || branch.city !== city) { setBranchId(''); clearAfterBranch(); openPanel('shop'); if (draft.rebooking || draft.favourite) setRebookNotice('shopUnavailable'); return; }
    const validServices = barber && serviceIds.length > 0 && selectedServices.length === serviceIds.length && (draft?.bookingMode !== 'time' || duration <= (catalog.maxDuration || 480));
    const validDate = barber && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getKuwaitDate() && date <= addBookingDays(getKuwaitDate(), barber.maxBookingDays || 30);
    const validTime = validDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (!barber) { clearAfterBranch(); if (draft.rebooking || (draft.favourite && draft.barberId)) setRebookNotice('barberUnavailable'); }
    else if (!validServices) { setServiceIds([]); setTime(''); }
    if (!validDate) { setDate(getKuwaitDate()); setTime(''); }
    if (!validTime) setTime('');
    const nextIncomplete = !barber ? 'barber' : !validServices ? 'services' : validTime ? 'details' : 'time';
    const requestedPanel = PANELS.includes(draft.panel) ? draft.panel : draft.step === 0 ? 'barber' : draft.step === 1 ? 'services' : nextIncomplete;
    const available = { city: true, shop: Boolean(city), barber: Boolean(branch), services: Boolean(barber), time: validServices, details: validServices && validTime };
    openPanel(available[requestedPanel] ? requestedPanel : nextIncomplete);
  }, [catalogLoading, catalogError, catalog]);
  useEffect(() => {
    if (receipt) saveBookingDraft(null);
    else if (draftRestored && city) saveBookingDraft({
      bookingMode: draft?.bookingMode, rangeStart: draft?.rangeStart, rangeEnd: draft?.rangeEnd,
      city, branchId, barberId, serviceIds, date, time, panel, query,
      step: Math.floor(PANELS.indexOf(panel) / 2),
      rebooking: Boolean(draft?.rebooking), favourite: Boolean(draft?.favourite), rebookNotice, guest, details,
    });
  }, [draftRestored, city, branchId, barberId, serviceIds, date, time, panel, query, receipt, rebookNotice, guest, details]);
  useEffect(() => {
    const previous = document.title;
    document.title = t('customerBooking.pageTitle');
    return () => { document.title = previous; };
  }, [t]);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true); setCatalogError(false); setError('');
    (scopedCatalog ? Promise.resolve(scopedCatalog) : customerBookingService.getCatalog()).then(data => { if (active) setCatalog(data); })
      .catch(() => { if (active) { setError('UNAVAILABLE'); setCatalogError(true); } })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [receipt]);
  useEffect(() => {
    if (!appointmentFocusRef.current) return;
    const target = document.getElementById(appointmentFocusRef.current);
    if (target) {
      target.focus({ preventScroll: true });
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      document.getElementById(`choose-${panel}`)?.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
      appointmentFocusRef.current = '';
    }
  }, [panel, catalogLoading]);
  const serviceKey = serviceIds.join(',');
  const checkingAvailability = (panel === 'time' || panel === 'details') && Boolean(branch && barber && selectedServices.length);
  useEffect(() => {
    if (!checkingAvailability || !date || receipt) return undefined;
    let active = true;
    setSlotsLoading(true); setSlots([]); setBookingPolicy(null); setSlotError(false);
    customerBookingService.getSlots({ branchId, barberId, serviceIds: serviceKey.split(','), date })
      .then(result => { if (active) { const available = draft?.bookingMode === 'time' ? result.slots.filter(slot => slot >= draft.rangeStart && slot <= draft.rangeEnd) : result.slots; setSlots(available); setBookingPolicy(result.booking_policy || null); setTime(current => available.includes(current) ? current : ''); if (time && !available.includes(time)) { openPanel('time'); setError('SLOT_UNAVAILABLE'); } } })
      .catch(async failure => {
        if (!active) return;
        setError(failure.message);
        if (failure.message === 'INVALID_SELECTION' && onEditProvider) editSection('barber');
        else if (failure.message === 'INVALID_SELECTION') await recoverUnavailableSelection(() => active);
        else { setSlotError(true); setTime(''); openPanel('time'); }
      })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [checkingAvailability, branchId, barberId, serviceKey, date, slotRetry, receipt, customer?.id]);

  const validGuestDetails = () => {
    const errors = {};
    if (details.name.trim().length < 2 || details.name.trim().length > 120) errors.name = tr('nameError');
    if (!validatePhoneNumber(details.phone.replace(/[\s()-]/g, ''), details.countryCode).valid) errors.phone = tr('phoneError');
    setFieldErrors(errors);
    if (Object.keys(errors).length) setTimeout(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus(), 0);
    return !Object.keys(errors).length;
  };
  const fullPhone = details.countryCode + details.phone.replace(/[\s()-]/g, '');
  useEffect(() => {
    if (!customer?.ownBarberIds?.includes(barberId)) return;
    if (onEditProvider) { editSection('barber'); return; }
    setBarberId(''); setServiceIds([]); setTime(''); setPanel('barber'); setError('SELF_BOOKING_NOT_ALLOWED');
  }, [customer?.id, customer?.ownBarberIds?.join(','), barberId]);

  const activePhoneSession = phoneSession?.phone === fullPhone && phoneSession?.account === customer?.id ? phoneSession : null;
  useEffect(() => {
    let active = true;
    customerBookingService.phoneConfig().then(config => { if (active) setPhoneConfig(config); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const accountPhoneKey = phoneConfig && customer?.phone
    ? [customer.id, customer.countryCode, customer.phone].join(':')
    : null;
  useEffect(() => {
    if (!accountPhoneKey || panel !== 'details' || receipt) return;
    let active = true;
    const finish = required => {
      if (active) setAccountPhoneCheck({ key: accountPhoneKey, required });
    };
    customerBookingService.accountProof().then(
      () => finish(false),
      failure => finish(failure.message === 'PHONE_VERIFICATION_REQUIRED'),
    );
    return () => { active = false; };
  }, [accountPhoneKey, panel, receipt]);
  useEffect(() => {
    if (!activePhoneSession) return;
    // The send request disables the fieldset. Move focus once it is enabled.
    const focus = requestAnimationFrame(() => phoneCodeRef.current?.focus());
    const tick = () => setResendIn(Math.max(0, Math.ceil((activePhoneSession.resendAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => { cancelAnimationFrame(focus); clearInterval(timer); };
  }, [activePhoneSession]);
  const sendPhoneCode = async config => {
    if (!captchaRef.current) throw new Error('PHONE_UNAVAILABLE');
    let session;
    if (config.testPhones) {
      session = await customerBookingService.startTestPhone(fullPhone);
    } else {
      const challenge = new AbortController();
      phoneChallengeRef.current = challenge;
      setPhoneChallenge(challenge);
      try {
        const { sendCheckoutPhoneCode } = await import('../services/checkoutPhone.service');
        session = await sendCheckoutPhoneCode(config, fullPhone, captchaRef.current, isArabic ? 'ar' : 'en', challenge.signal);
      } finally {
        phoneChallengeRef.current = null;
        setPhoneChallenge(null);
      }
    }
    setPhoneCode('');
    setPhoneSession({ session, phone: fullPhone, account: customer?.id, resendAt: Date.now() + 30_000 });
  };
  const resendPhoneCode = async () => {
    if (busy || resendIn || !phoneConfig || !validGuestDetails()) return;
    setBusy(true); setError('');
    try { await sendPhoneCode(phoneConfig); }
    catch (failure) { if (failure.message !== 'PHONE_CANCELLED') setError(failure.message); }
    finally { setBusy(false); }
  };
  const confirmBooking = async event => {
    event.preventDefault();
    if (busy || !appointmentReady || panel !== 'details' || accountLoading || (!customer && !guest)) return;
    if (!validGuestDetails()) return;
    setBusy(true); setError('');
    try {
      const config = phoneConfig || (customer && !customer.phone ? await customerBookingService.phoneConfig() : null);
      if (!config && customer && !customer.phone) {
        await updateProfile({ name: customer.name, email: customer.email, countryCode: details.countryCode, phone: details.phone });
      }
      // Preserve the same signed booking ID across uncertain network retries.
      let proof = verification;
      if (!proof && activePhoneSession) {
        if (!/^\d{6}$/.test(phoneCode)) throw new Error('INVALID_CODE');
        proof = (await customerBookingService.confirmPhone({ ...details, session: activePhoneSession.session, code: phoneCode })).verification;
        setPhoneCode('');
        setPhoneSession(null);
      }
      if (!proof) {
        try {
          proof = (customer ? await customerBookingService.accountProof() : await customerBookingService.guestProof(details)).verification;
        } catch (failure) {
          if (failure.message !== 'PHONE_VERIFICATION_REQUIRED') throw failure;
          const settings = config || await customerBookingService.phoneConfig();
          if (!settings) throw new Error('PHONE_UNAVAILABLE', { cause: failure });
          setPhoneConfig(settings);
          if (accountPhoneKey) setAccountPhoneCheck({ key: accountPhoneKey, required: true });
          await sendPhoneCode(settings);
          return;
        }
      }
      setVerification(proof);
      const result = await customerBookingService.book({ ...selection, time, verification: proof, notes: details.notes, bookingPolicy: bookingPolicy || undefined });
      const confirmed = { ...result, accountSaved: Boolean(customer) };
      saveBookingReceipt(confirmed); setReceipt(confirmed);
    } catch (failure) {
      if (failure.message === 'PHONE_CANCELLED') return;
      setError(failure.message);
      if (failure.message === 'SLOT_UNAVAILABLE') { setTime(''); openPanel('time'); setSlotRetry(value => value + 1); }
      if (failure.message === 'BOOKING_POLICY_CHANGED') setSlotRetry(value => value + 1);
      if (failure.message === 'INVALID_SELECTION') await recoverUnavailableSelection();
      if (failure.message === 'PHONE_VERIFICATION_REQUIRED' || failure.message === 'PHONE_CHANGED') {
        setVerification(''); setPhoneSession(null); setPhoneCode('');
        setError('PHONE_CHANGED');
        if (customer) await refresh();
      }
      if (failure.message === 'VERIFICATION_REQUIRED') { setVerification(''); if (customer) await refresh(); }
    } finally { setBusy(false); }
  };
  const appointmentReady = Boolean(branch && barber && selectedServices.length && time && !slotsLoading && !slotError);
  const finalDetails = panel === 'details';
  const canContinue = panel === 'city' ? Boolean(city) : panel === 'shop' ? Boolean(branch) : panel === 'barber' ? Boolean(barber) : panel === 'services' ? Boolean(selectedServices.length) : appointmentReady && !accountLoading && (!finalDetails || Boolean(customer) || guest);
  const phoneCheckPending = accountPhoneKey && accountPhoneCheck?.key !== accountPhoneKey;
  const showPhoneVerification = phoneConfig && !verification
    && (activePhoneSession || !accountPhoneKey || (!phoneCheckPending && accountPhoneCheck?.required));
  const inlinePhoneError = showPhoneVerification
    && ['INVALID_CODE', 'PHONE_TEST_NUMBER', 'PHONE_RATE_LIMIT', 'PHONE_UNAVAILABLE', 'PHONE_CHANGED'].includes(error);
  const testNumber = phoneConfig?.testPhones?.[0];
  const hasUnsupportedSavedNumber = testNumber && customer?.phone && !phoneConfig.testPhones.includes(fullPhone);
  const nextLabel = panel === 'city' ? tr('continue.branch') : panel === 'shop' ? tr('continue.barber') : panel === 'barber' ? tr('continue.services') : panel === 'services' ? tr('guided.nextTime') : tr('continue.details');
  const bookingSubmit = (label, disabled = false) => (
    <button id="booking-next" type="submit" form="booking-confirm-form" className="cb-primary"
      disabled={!canContinue || busy || catalogError || disabled}>
      {busy && <Loader2 size={19} className="cb-spinner" />}{busy ? tr(phoneChallenge ? 'phoneVerification.waiting' : 'working') : label}
      {!busy && <ArrowRight size={20} className="cb-directional" />}
    </button>
  );
  const panelIndex = PANELS.indexOf(panel);
  const title = receipt ? tr('successTitle') : tr(draft?.rebooking ? 'rebooking.title' : 'onePage.title');
  const downloadCalendar = () => {
    downloadBookingCalendar(receipt);
  };
  const renderSummary = (data = null) => <dl className="cb-review-list">
    <div><dt>{tr('steps.branch')}</dt><dd>{data ? (isArabic && data.branchNameAr || data.branchName) : name(branch)}{!data && <button type="button" onClick={() => editSection('shop')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.branch')}`}>{tr('edit')}</button>}</dd></div>
    <div><dt>{tr('steps.barber')}</dt><dd>{data ? (isArabic && data.barberNameAr || data.barberName) : name(barber)}{!data && <button type="button" onClick={() => editSection('barber')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.barber')}`}>{tr('edit')}</button>}</dd></div>
    <div><dt>{tr('steps.services')}</dt><dd>{(data?.services || selectedServices).map(name).join(isArabic ? '، ' : ', ')}{!data && <button type="button" onClick={() => editSection('services')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.services')}`}>{tr('edit')}</button>}</dd></div>
    <div><dt>{tr('steps.time')}</dt><dd>{dateLabel(data?.date || date)}<br />{timeLabel(data?.time || time)} · {tr('minutes', { count: data?.duration || duration })}{!data && <button type="button" onClick={() => editSection('time')} disabled={busy} aria-label={`${tr('edit')}: ${tr('steps.time')}`}>{tr('edit')}</button>}</dd></div>
    <div className="cb-total"><dt>{tr('total')}</dt><dd>{money(data?.price ?? price)}</dd></div>
  </dl>;

  const policyDeadline = (minutes, action) => {
    const start = new Date(`${date}T${time}:00+03:00`);
    const deadline = new Date(start.getTime() - minutes * 60000);
    if (deadline <= new Date()) return t(`bookingPolicy.${action}Closed`);
    const label = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(deadline);
    return t(`bookingPolicy.${action}By`, { date: label });
  };

  const bookingError = error && <div className="cb-alert" role="alert"><span>{errorText(error)}</span>{(catalogError || slotError) && <button type="button" disabled={busy} onClick={() => { setError(''); if (catalogError) setReload(value => value + 1); else setSlotRetry(value => value + 1); }}>{tr('retry')}</button>}</div>;

  return <div className="customer-booking" dir={isArabic ? 'rtl' : 'ltr'}>

    <div className="cb-layout">
      <main className="cb-main" id="booking-content">
        {!receipt && <div className="cb-progress" role="status">
          <span>{tr('onePage.sectionOf', { current: panelIndex + 1, total: PANELS.length })}</span>
          <div className="cb-progress-track" aria-hidden="true"><span style={{ width: `${(panelIndex + 1) / PANELS.length * 100}%` }} /></div>
        </div>}
        {receipt && <CheckCircle2 size={46} className="cb-success-icon" aria-hidden="true" />}
        <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
        <p className="cb-intro">{receipt ? tr('successIntro') : draft?.rebooking ? tr('rebooking.intro') : scopedCatalog ? t('bookingFinder.finishIntro') : tr('onePage.intro')}</p>
        {accountError && <p className="cb-alert" role="alert">{t('accountMode.loadFailed')} <button type="button" className="cb-text-button" onClick={refresh}>{t('common.retry')}</button></p>}
        {!receipt && ['shopUnavailable', 'barberUnavailable'].includes(rebookNotice) && <p className="cb-alert" role="status">{tr(`rebooking.${rebookNotice}`)}</p>}
        {catalogError && bookingError}
        {catalogLoading ? <div className="cb-loading" role="status"><Loader2 size={22} className="cb-spinner" />{tr('loading')}</div> : receipt ? <div className="cb-success">
          <div className="cb-reference"><ShieldCheck size={20} aria-hidden="true" /><span>{tr('reference')} <strong dir="ltr">{receipt.reference}</strong></span></div>
          {renderSummary(receipt)}
          <p className="cb-payment"><Store size={20} aria-hidden="true" /><span>{tr('payAtShop')}</span></p>
          <section className="cb-account-choice" aria-label={tr('accountChoice.saveTitle')}>
            {receipt.accountSaved ? <><p role="status"><CheckCircle2 size={20} aria-hidden="true" />{tr('accountChoice.saved')}</p><Link className="cb-text-button" to="/customer/account">{t('customerAuth.myAccount')}</Link></> : <>
              <h2>{tr('accountChoice.saveTitle')}</h2><p>{tr('accountChoice.saveHint')}</p>
              {claimError && <p className="cb-alert" role="alert">{tr(`accountChoice.${claimError === 'CLAIM_UNAVAILABLE' ? 'claimMismatch' : 'claimFailed'}`)}</p>}
              {!customer ? <Link className="cb-secondary" to="/customer/sign-in?next=book" state={{ returnTo: '/book' }} onClick={rememberBookingReturn}>{tr('accountChoice.signInSave')}</Link> : <>
                <button className="cb-secondary" type="button" disabled={claimBusy || accountLoading || !receipt.claimToken} onClick={async () => {
                  setClaimBusy(true); setClaimError('');
                  try { await customerBookingService.claim(receipt.claimToken); const saved = { ...receipt, accountSaved: true, claimToken: undefined }; saveBookingReceipt(saved); setReceipt(saved); }
                  catch (failure) { setClaimError(failure.message); } finally { setClaimBusy(false); }
                }}>{claimBusy && <Loader2 className="cb-spinner" size={18} aria-hidden="true" />}{tr('accountChoice.save')}</button>
                {claimError === 'CLAIM_UNAVAILABLE' && <Link className="cb-text-button" to="/customer/account">{t('customerAuth.manageAccount')}</Link>}
              </>}
            </>}
          </section>
          <div className="cb-success-actions"><button type="button" className="cb-primary" onClick={downloadCalendar}><Download size={18} />{tr('addCalendar')}</button>{safeBookingUrl(receipt.locationUrl) && <a className="cb-secondary" href={safeBookingUrl(receipt.locationUrl)} target="_blank" rel="noreferrer">{tr('directions')}</a>}<button type="button" className="cb-text-button" onClick={() => { saveBookingReceipt(null); saveBookingDraft(null); window.location.reload(); }}>{tr('anotherBooking')}</button></div>
        </div> : <>
          <FavouriteFeedback />
          <BookingSection feedback={panel === 'city' && !catalogError ? bookingError : null} id="choose-city" title={tr('titles.city')} summary={cityName(city)} open={panel === 'city'} onEdit={() => editSection('city')} onDone={() => openPanel('shop')} editLabel={tr('edit')} doneLabel={tr('guided.done')} disabled={busy}>
            <div className="cb-city-step"><CityPicker groups={cityGroups} value={city} onChange={changeCity} cityName={cityName} governorateName={governorateName} disabled={busy || !cities.length} />{cities.length === 0 && !error && <p className="cb-empty">{tr('noCities')}</p>}</div>
          </BookingSection>
          <BookingSection feedback={panel === 'shop' && !catalogError ? bookingError : null} id="choose-shop" title={tr('titles.branch')} summary={name(branch)} open={panel === 'shop' && Boolean(city)} onEdit={() => editSection('shop')} onDone={() => openPanel('barber')} editLabel={tr('edit')} doneLabel={tr('guided.done')} disabled={busy}>
              <label className="cb-field-label" htmlFor="branch-search">{tr('searchLabel')}</label><div className="cb-search"><Search size={23} aria-hidden="true" /><input id="branch-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tr('searchPlaceholder')} /></div><p className="cb-result-count" aria-live="polite">{tr('branchesCount', { count: branches.length })}</p>
              <fieldset className="cb-options"><legend className="sr-only">{tr('titles.branch')}</legend>{branches.map(item => <div key={item.id} className="cf-select-row"><label className={`cb-option ${branchId === item.id ? 'selected' : ''}`}><input type="radio" name="branch" value={item.id} checked={branchId === item.id} onClick={() => { if (branchId === item.id) openPanel('barber'); }} onChange={() => selectBranch(item.id)} /><BookingImage src={item.logoUrl} name={name(item)} /><span className="cb-option-copy"><strong>{name(item)}</strong><span>{(isArabic ? item.areaAr : item.area) || item.address || item.city}</span><CatalogRating rating={item.rating} /></span><span className="cb-radio" aria-hidden="true">{branchId === item.id && <Check size={17} />}</span></label><FavouriteButton kind="shop" targetId={item.id} name={name(item)} disabled={busy} /></div>)}</fieldset>
              {branches.length === 0 && <div className="cb-empty"><Store size={28} aria-hidden="true" /><h2>{tr('noBranches')}</h2><p>{tr('noBranchesHint')}</p>{query && <button type="button" className="cb-text-button" onClick={() => setQuery('')}>{tr('clearSearch')}</button>}</div>}
          </BookingSection>
          <BookingSection feedback={panel === 'barber' && !catalogError ? bookingError : null} id="choose-barber" title={tr('titles.barber')} summary={name(barber)} open={panel === 'barber'} onEdit={() => editSection('barber')} editLabel={tr('edit')} doneLabel={tr('guided.done')} onDone={() => openPanel('services')} disabled={busy}>
              <fieldset className="cb-options"><legend className="sr-only">{tr('titles.barber')}</legend>{barbers.map(item => <div key={item.id} className="cf-select-row"><label className={`cb-option ${barberId === item.id ? 'selected' : ''}`}><input type="radio" name="barber" checked={barberId === item.id} onClick={() => { if (barberId === item.id) openPanel('services'); }} onChange={() => selectBarber(item.id)} /><BookingImage src={item.avatarUrl} name={name(item)} person /><span className="cb-option-copy"><strong>{name(item)}</strong><span>{tr('servicesCount', { count: getBarberServices(catalog, branchId, item.id).length })}</span><CatalogRating rating={item.rating} /></span><span className="cb-radio" aria-hidden="true">{barberId === item.id && <Check size={17} />}</span></label><FavouriteButton kind="barber" targetId={item.id} name={name(item)} disabled={busy} /></div>)}</fieldset>
              {branch && !barbers.length && <div className="cb-empty"><UserRound size={28} /><h2>{ownShopProfile ? t('accountMode.noOtherBarbers') : tr('noBarbers')}</h2><p>{ownShopProfile ? t('accountMode.chooseOtherShop') : tr('noBarbersHint')}</p><button type="button" className="cb-text-button" onClick={() => editSection('shop')}>{tr('changeBranch')}</button></div>}
          </BookingSection>
          <BookingSection feedback={panel === 'services' && !catalogError ? bookingError : null} id="choose-services" title={tr('steps.services')} summary={selectedServices.map(name).join(isArabic ? '، ' : ', ')} open={panel === 'services' && Boolean(barber)} onEdit={() => openPanel('services')} editLabel={tr('edit')} disabled={busy}>
                <fieldset className="cb-options" disabled={!barber}><legend className="sr-only">{tr('titles.services')}</legend>{services.map(item => <label key={item.id} className={`cb-option cb-service ${serviceIds.includes(item.id) ? 'selected' : ''}`}><input type="checkbox" disabled={!serviceIds.includes(item.id) && (serviceIds.length >= 10 || duration + item.duration > (draft?.bookingMode === 'time' ? catalog.maxDuration || 480 : 480))} checked={serviceIds.includes(item.id)} onChange={() => toggleService(item.id)} /><span className="cb-option-copy"><strong>{name(item)}</strong><span>{tr('minutes', { count: item.duration })}</span></span><strong className="cb-service-price">{money(item.price)}</strong><span className="cb-radio cb-checkbox" aria-hidden="true">{serviceIds.includes(item.id) && <Check size={17} />}</span></label>)}</fieldset>
                {draft?.bookingMode === 'time' && <p className="cb-helper">{t('bookingFinder.serviceFit')} <button type="button" className="cb-text-button" onClick={() => editSection('range')}>{t('bookingFinder.changeRange')}</button></p>}<p className="cb-helper"><Clock size={17} aria-hidden="true" />{tr('serviceHint')}</p>
          </BookingSection>
          <BookingSection feedback={panel === 'time' && !catalogError ? bookingError : null} id="choose-time" title={tr('steps.time')} summary={time ? `${dateLabel(date)} · ${timeLabel(time)}` : ''} open={panel === 'time'} onEdit={() => openPanel('time')} editLabel={tr('edit')} doneLabel={tr('guided.done')} onDone={() => openPanel('details')} disabled={busy || !appointmentReady}>
                <label htmlFor="booking-date" className="cb-field-label">{tr('dateLabel')}</label><div className="cb-date-field"><input className="cb-input cb-date" id="booking-date" type="date" readOnly={draft?.bookingMode === 'time'} value={date} min={getKuwaitDate()} max={addBookingDays(getKuwaitDate(), barber?.maxBookingDays || 30)} onChange={event => { setDate(event.target.value); setTime(''); setPanel('time'); setError(''); }} required /></div>{draft?.bookingMode === 'time' && <button className="cb-text-button" type="button" onClick={() => editSection('range')}>{t('bookingFinder.changeRange')} <bdi>{draft.rangeStart}–{draft.rangeEnd}</bdi></button>}<p className="cb-helper">{tr('kuwaitTime')}</p><h3 className="cb-time-heading">{tr('timeLabel')}</h3>
                {slotsLoading ? <p className="cb-loading" role="status"><Loader2 size={20} className="cb-spinner" />{tr('loadingTimes')}</p> : <fieldset className="cb-time-options"><legend className="sr-only">{tr('timeLabel')}</legend>{slots.map(slot => <label key={slot} className={time === slot ? 'selected' : ''}><input type="radio" name="time" checked={time === slot} onChange={() => { setTime(slot); openPanel('details'); setError(''); }} /><span>{timeLabel(slot)}</span>{time === slot && <Check size={15} aria-hidden="true" />}</label>)}</fieldset>}
                {checkingAvailability && !slotsLoading && !slots.length && !slotError && <div className="cb-empty"><Calendar size={28} aria-hidden="true" /><h3>{tr('noTimes')}</h3><p>{tr('noTimesHint')}</p></div>}
          </BookingSection>
          <BookingSection feedback={panel === 'details' && !catalogError && !inlinePhoneError ? bookingError : null} id="choose-details" title={tr('guided.details')} summary={time ? customer?.name || (details.name && details.phone ? `${details.name} · ${details.countryCode} ${details.phone}` : '') : ''} open={panel === 'details' && Boolean(time)} onEdit={() => openPanel('details')} editLabel={tr('edit')} disabled={busy || !appointmentReady}>
              {time && date && <>
                {!customer && !accountLoading && <section className="cb-account-choice" aria-labelledby="booking-account-choice-title">
                  <h3 id="booking-account-choice-title">{tr('accountChoice.title')}</h3><p>{tr('accountChoice.hint')}</p>
                  <div className="cb-account-choice-actions"><Link className="cb-primary" to="/customer/sign-in?next=book" state={{ returnTo: '/book' }} onClick={rememberBookingReturn}>{t('customerAuth.signIn')}</Link><button className="cb-secondary" type="button" onClick={() => { setGuest(true); setTimeout(() => formRef.current?.querySelector('input')?.focus(), 0); }} aria-pressed={guest}>{tr('accountChoice.guest')}</button></div>
                  {guest && <p className="cb-helper">{tr('accountChoice.guestHint')}</p>}
                </section>}
                <section className="cb-confirm-summary" aria-label={tr('three.bookingSummary')}>{renderSummary()}</section>
                {(customer || guest) && !accountLoading && <form ref={formRef} className="cb-details" onSubmit={confirmBooking} id="booking-confirm-form" noValidate>
                  <fieldset className="cb-details-fields" disabled={busy}>
                    {customer ? <>
                      <div className="cb-verified-details"><div><strong>{customer.name}</strong><br /><bdi>{customer.countryCode} {customer.phone}</bdi></div><Link to="/customer/account">{t('customerAuth.manageAccount')}</Link></div><p className="cb-helper">{t('customerAuth.accountDetails')}</p>
                      {!customer.phone && <><label className="cb-field-label" htmlFor="customer-phone">{tr('phoneLabel')}</label><div className="cb-phone-input" dir="ltr"><select aria-label={tr('countryCode')} value={details.countryCode} onChange={event => { setDetails(current => ({ ...current, countryCode: event.target.value })); setVerification(''); setPhoneSession(null); setPhoneCode(''); setFieldErrors(current => ({ ...current, phone: '' })); }}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.flag} {country.code}</option>)}</select><input id="customer-phone" type="tel" autoComplete="tel-national" value={details.phone} maxLength={14} onChange={event => { setDetails(current => ({ ...current, phone: event.target.value.replace(/[^0-9\s()-]/g, '') })); setVerification(''); setPhoneSession(null); setPhoneCode(''); setFieldErrors(current => ({ ...current, phone: '' })); }} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'customer-phone-error' : undefined} required /></div>{fieldErrors.phone && <p className="cb-field-error" id="customer-phone-error">{fieldErrors.phone}</p>}</>}
                      <label htmlFor="booking-notes" className="cb-field-label">{tr('notesLabel')}</label><textarea id="booking-notes" className="cb-input" rows={2} maxLength={500} value={details.notes} onChange={event => setDetails(current => ({ ...current, notes: event.target.value }))} />
                    </> : <>
                      <label className="cb-field-label" htmlFor="customer-name">{tr('nameLabel')}</label><input id="customer-name" className="cb-input" autoComplete="name" value={details.name} maxLength={120} onChange={event => { setDetails(current => ({ ...current, name: event.target.value })); setVerification(''); setFieldErrors(current => ({ ...current, name: '' })); }} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'customer-name-error' : undefined} required />{fieldErrors.name && <p className="cb-field-error" id="customer-name-error">{fieldErrors.name}</p>}
                      <label className="cb-field-label" htmlFor="customer-phone">{tr('phoneLabel')}</label><div className="cb-phone-input" dir="ltr"><select aria-label={tr('countryCode')} value={details.countryCode} onChange={event => { setDetails(current => ({ ...current, countryCode: event.target.value })); setVerification(''); setPhoneSession(null); setPhoneCode(''); setFieldErrors(current => ({ ...current, phone: '' })); }}>{GCC_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.flag} {country.code}</option>)}</select><input id="customer-phone" type="tel" autoComplete="tel-national" value={details.phone} maxLength={14} onChange={event => { setDetails(current => ({ ...current, phone: event.target.value.replace(/[^0-9\s()-]/g, '') })); setVerification(''); setPhoneSession(null); setPhoneCode(''); setFieldErrors(current => ({ ...current, phone: '' })); }} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'customer-phone-error' : undefined} required /></div>{fieldErrors.phone && <p className="cb-field-error" id="customer-phone-error">{fieldErrors.phone}</p>}
                      <label htmlFor="booking-notes" className="cb-field-label">{tr('notesLabel')}</label><textarea id="booking-notes" className="cb-input" rows={2} maxLength={500} value={details.notes} onChange={event => setDetails(current => ({ ...current, notes: event.target.value }))} /><p className="cb-helper">{tr('noAccount')}</p>
                    </>}
                    <div ref={captchaRef} />
                    {showPhoneVerification && <div className="cb-account-choice">
                      <h3>{tr('phoneVerification.title')}</h3>
                      <p>{activePhoneSession
                        ? tr('phoneVerification.sent', { phone: '\u2066' + fullPhone + '\u2069' })
                        : tr('phoneVerification.hint')}</p>
                      {testNumber && <p>{tr(hasUnsupportedSavedNumber ? 'phoneVerification.testSavedNumber' : 'phoneVerification.testHint', {
                        phone: '\u2066' + testNumber + '\u2069',
                      })}</p>}
                      {activePhoneSession && <>
                        <label className="cb-field-label" htmlFor="booking-phone-code">{tr('phoneVerification.code')}</label>
                        <input ref={phoneCodeRef} id="booking-phone-code" className="cb-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={phoneCode} onChange={event => setPhoneCode(event.target.value.replace(/[^0-9]/g, ''))} />
                      </>}
                      {inlinePhoneError && bookingError}
                      <div className="cb-account-choice-actions cb-phone-verification-actions">
                        {bookingSubmit(tr(activePhoneSession ? 'phoneVerification.verifyAndBook' : 'phoneVerification.send'),
                          Boolean(hasUnsupportedSavedNumber || (activePhoneSession && phoneCode.length !== 6)))}
                        {activePhoneSession && <button className="cb-secondary" type="button" disabled={resendIn > 0}
                          onClick={resendPhoneCode}>{resendIn > 0 ? tr('phoneVerification.wait', { count: resendIn }) : tr('phoneVerification.resend')}</button>}
                      </div>
                    </div>}
                  </fieldset>
                  {phoneChallenge && <button type="button" className="cb-secondary"
                    onClick={() => phoneChallenge.abort()}>{tr('phoneVerification.cancel')}</button>}
                </form>}
                {bookingPolicy && time && <div className="cb-account-choice">
                  <h3>{t('bookingPolicy.checkoutTitle')}</h3>
                  <p>{policyDeadline(bookingPolicy.cancel_minutes, 'cancel')}</p>
                  <p>{policyDeadline(bookingPolicy.reschedule_minutes, 'reschedule')}</p>
                  <p>{t('customerAuth.account.timezone')}</p>
                </div>}
                <p className="cb-payment"><Store size={20} aria-hidden="true" /><span>{tr('payAtShop')}</span></p>
              </>}
          </BookingSection>
        </>}
        {!catalogLoading && !receipt && (!finalDetails || ((customer || guest) && !showPhoneVerification)) && <footer className="cb-actions">
          <div className="cb-action-context" aria-live="polite">{selectedServices.length ? totalLabel : branch ? tr('branchSelected', { name: name(branch) }) : cityName(city)}</div>
          <div className="cb-action-buttons">
            {finalDetails
              ? bookingSubmit(tr(phoneCheckPending ? 'phoneVerification.checking' : 'confirm'), Boolean(phoneCheckPending))
              : <button id="booking-next" type="button" className="cb-primary" disabled={!canContinue || busy || catalogError}
                onClick={() => openPanel(PANELS[panelIndex + 1])}>{nextLabel}<ArrowRight size={20} className="cb-directional" /></button>}
          </div>
        </footer>}
      </main>
    </div>
  </div>;
}

export default function CustomerBooking() {
  return <BookingFinder checkout={CustomerBookingCheckout} />;
}
