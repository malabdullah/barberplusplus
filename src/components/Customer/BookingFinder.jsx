import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Calendar, Clock, Loader2, Search, Store, UserRound } from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useCustomerFavourites } from '../../context/CustomerFavouritesContext';
import { customerBookingService } from '../../services/customerBooking.service';
import { readBookingDraft, readBookingReceipt, readBookingReturnDraft, saveBookingDraft, saveBookingReceipt } from '../../utils/customerBookingDraft';
import { getKuwaitDate, addBookingDays } from '../../utils/customerBooking';
import { bookingCityGroups } from '../../utils/bookingCityGroups';
import { shopWording } from '../../utils/customerTerminology';
import CityPicker from './CityPicker';
import BookingImage from './BookingImage';
import CatalogRating from './CatalogRating';
import FavouriteButton from './FavouriteButton';
import FavouriteFeedback from './FavouriteFeedback';
import './BookingFinder.css';

const empty = { city: '', branchId: '', barberId: '', serviceIds: [], date: '', time: '', step: 0 };
const emptyCatalog = { branches: [], barbers: [], services: [] };
export default function BookingFinder({ checkout: Checkout }) {
  const { t, i18n } = useTranslation(); const tr = (key, values) => t(`bookingFinder.${key}`, values);
  const { customer, loading: authLoading } = useCustomerAuth(); const { items: favourites } = useCustomerFavourites();
  const location = useLocation();
  const [initial] = useState(() => location.state?.bookingDraft || location.state?.rebookingDraft || readBookingReturnDraft() || readBookingDraft());
  const [draft, setDraft] = useState(() => ({ ...empty, ...initial }));
  const [receipt] = useState(() => !initial && readBookingReceipt());
  const [mode, setMode] = useState(initial?.bookingMode || (initial ? 'shop' : ''));
  const [stage, setStage] = useState(initial?.finderStage || (initial?.barberId ? 'restore' : initial?.branchId ? 'results' : initial?.city ? 'results' : 'city'));
  const [catalog, setCatalog] = useState(receipt ? emptyCatalog : null);
  const [filters, setFilters] = useState([]); const [filterError, setFilterError] = useState(false);
  const [query, setQuery] = useState(typeof initial?.query === 'string' ? initial.query : ''); const [items, setItems] = useState([]); const [kind, setKind] = useState('');
  const [cursor, setCursor] = useState(null); const [history, setHistory] = useState([]); const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const heading = useRef(null); const requestVersion = useRef(0);
  const arabic = i18n.language.startsWith('ar');
  const name = item => shopWording(arabic && item.name_ar ? item.name_ar : item.name || '');
  const groups = useMemo(() => bookingCityGroups(filters.map(item => ({ city: item.city, cityAr: item.city_ar,
    governorateId: item.governorates?.id, governorateName: item.governorates?.name_en, governorateNameAr: item.governorates?.name_ar }))), [filters]);
  const cityName = city => t(`customerBooking.cities.${city}`, { defaultValue: arabic && filters.find(item => item.city === city)?.city_ar || city });
  const governorateName = group => t(`customerBooking.governorates.${group.key}`, { defaultValue: arabic && group.nameAr ? group.nameAr : group.name });
  const params = { mode: mode || 'shop', city: draft.city, branchId: mode === 'shop' ? draft.branchId : '',
    date: draft.date, rangeStart: draft.rangeStart, rangeEnd: draft.rangeEnd };
  const resetPage = () => { setCursor(null); setHistory([]); setNext(null); };
  const patch = values => { setDraft(current => ({ ...current, ...values })); resetPage(); };
  const edit = (target, current) => {
    requestVersion.current++; setCatalog(null); setError(''); setQuery(''); resetPage();
    setDraft(current); setMode(target === 'method' ? '' : current.bookingMode || mode || 'shop');
    setStage(target === 'range' ? 'range' : target === 'city' ? 'city' : 'results');
    if (target === 'city' || target === 'shop') setDraft(value => ({ ...value, branchId: '', barberId: '' }));
  };
  const chooseMode = value => {
    requestVersion.current++; setMode(value); setStage(value === 'time' ? 'range' : value === 'barber' ? 'results' : 'city');
    setCatalog(null); setError(''); setQuery(''); resetPage();
    patch({ bookingMode: value, branchId: '', barberId: '', serviceIds: [], time: '', date: draft.date || getKuwaitDate(), rangeStart: draft.rangeStart || '09:00', rangeEnd: draft.rangeEnd || '18:00' });
  };
  useEffect(() => {
    let live = true; setFilterError(false);
    customerBookingService.filters().then(value => { if (live) setFilters(value.cities); }).catch(() => { if (live) setFilterError(true); });
    return () => { live = false; };
  }, [retry]);
  useEffect(() => {
    if (!mode || catalog || stage === 'restore') return;
    saveBookingReceipt(null);
    saveBookingDraft({ ...draft, bookingMode: mode, finderStage: stage, query });
  }, [mode, stage, draft, query, catalog]);
  const select = async (id, restoring = false) => {
    const version = ++requestVersion.current; setLoading(true); setError('');
    try {
      const result = await customerBookingService.selection({ ...params, barberId: id });
      if (version !== requestVersion.current) return;
      const shop = result.branches[0];
      const same = id === draft.barberId;
      const selected = { ...draft, bookingMode: mode || 'shop', finderStage: undefined, city: shop.city,
        branchId: shop.id, barberId: id, serviceIds: same ? draft.serviceIds : [], time: same ? draft.time : '',
        panel: restoring ? draft.panel : same && draft.serviceIds.length ? draft.panel : 'services', step: 1 };
      saveBookingDraft(selected); setDraft(selected); setCatalog(result);
    } catch (failure) {
      if (version !== requestVersion.current) return;
      setError(['INVALID_SELECTION', 'SLOT_UNAVAILABLE'].includes(failure.message) ? 'changed' : 'failed');
      if (restoring) { setStage('results'); patch({ barberId: '', serviceIds: [], time: '' }); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  };
  useEffect(() => {
    if (stage === 'restore' && !authLoading) select(draft.barberId, true);
    // Restore once after the account session has been recovered.
  }, [stage, authLoading]);
  const favouriteKey = favourites.map(item => `${item.kind}:${item.targetId}`).sort().join(',');
  useEffect(() => {
    if (!mode || catalog || stage !== 'results' || authLoading) return;
    let live = true; const version = ++requestVersion.current;
    setLoading(true); setError(''); setItems([]);
    const timer = setTimeout(() => customerBookingService.search({ ...params, query, cursor }).then(result => {
      if (live && version === requestVersion.current) { setItems(result.items); setKind(result.kind); setNext(result.nextCursor); }
    }).catch(() => { if (live && version === requestVersion.current) setError('failed'); })
      .finally(() => { if (live && version === requestVersion.current) setLoading(false); }), 250);
    return () => { live = false; clearTimeout(timer); };
    // All search inputs are scalar; stale responses never replace a newer page.
  }, [mode, stage, catalog, draft.city, draft.branchId, draft.date, draft.rangeStart, draft.rangeEnd, query, cursor, authLoading, customer?.id, favouriteKey, retry]);
  useEffect(() => {
    if (!catalog) { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }, [mode, stage, catalog]);
  if (catalog) return <Checkout initialDraft={draft} scopedCatalog={catalog} cityMetadata={filters} onEditProvider={edit} />;
  const validRange = draft.date >= getKuwaitDate() && draft.date <= addBookingDays(getKuwaitDate(), 365)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.rangeStart || '') && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.rangeEnd || '') && draft.rangeStart <= draft.rangeEnd;
  return <div className="customer-booking bf-page" dir={arabic ? 'rtl' : 'ltr'}><div className="cb-layout"><main id="booking-content" className="cb-main">
    <h1 ref={heading} tabIndex={-1}>{!mode ? tr('title') : tr(`${mode}Title`)}</h1>
    {!mode ? <div className="bf-methods">{[['time', Calendar], ['barber', UserRound], ['shop', Store]].map(([value, Icon]) => <button key={value} type="button" className="bf-method" onClick={() => chooseMode(value)} data-booking-mode={value}><Icon size={26} aria-hidden="true" /><span><strong>{tr(`${value}Title`)}</strong><span>{tr(`${value}Description`)}</span></span><ArrowRight size={20} aria-hidden="true" /></button>)}</div> : <>
      <div className="bf-toolbar"><button className="cb-text-button" type="button" onClick={() => { requestVersion.current++; setMode(''); setLoading(false); }}><ArrowLeft size={16} />{tr('changeMethod')}</button>
        {mode === 'time' && stage !== 'range' && <button className="cb-text-button" type="button" onClick={() => setStage('range')}><Clock size={16} /><bdi>{draft.date} · {draft.rangeStart}–{draft.rangeEnd}</bdi></button>}
      </div>
      <FavouriteFeedback />
      {error && <p className="cb-alert" role="alert">{tr(error)} <button className="cb-text-button" type="button" onClick={() => setRetry(value => value + 1)}>{t('customerBooking.retry')}</button></p>}
      {stage === 'range' && <form className="bf-range" onSubmit={event => { event.preventDefault(); if (validRange) { setStage(draft.city ? 'results' : 'city'); patch({ time: '' }); } }}>
        <label htmlFor="finder-date">{t('customerBooking.dateLabel')}</label><input className="cb-input cb-date" id="finder-date" type="date" required min={getKuwaitDate()} max={addBookingDays(getKuwaitDate(),365)} value={draft.date} onChange={event => patch({ date: event.target.value, time: '' })} />
        <fieldset className="bf-range-times"><legend>{tr('startRange')}</legend><label>{tr('from')}<input className="cb-input" type="time" required value={draft.rangeStart || ''} onChange={event => patch({ rangeStart: event.target.value, time: '' })} /></label><label>{tr('to')}<input className="cb-input" type="time" required value={draft.rangeEnd || ''} onChange={event => patch({ rangeEnd: event.target.value, time: '' })} /></label></fieldset>
        <p className="cb-helper">{tr('rangeHint')}</p><p className="cb-helper">{t('customerBooking.kuwaitTime')}</p><button className="cb-primary" type="submit" disabled={!validRange}>{tr('chooseCity')}<ArrowRight size={18} /></button>
      </form>}
      {['city','results'].includes(stage) && <>
        {filterError ? <p className="cb-alert" role="alert">{tr('failed')} <button className="cb-text-button" type="button" onClick={() => setRetry(value => value + 1)}>{t('customerBooking.retry')}</button></p> : <div className="bf-city"><CityPicker groups={groups} value={draft.city} cityName={cityName} governorateName={governorateName} onChange={value => { setStage(mode === 'barber' || value ? 'results' : 'city'); setQuery(''); patch({ city: value, branchId: '', barberId: '', serviceIds: [], time: '' }); }} />{mode === 'barber' && draft.city && <button className="cb-text-button" type="button" onClick={() => patch({ city: '', branchId: '' })}>{tr('allCities')}</button>}</div>}
        {stage === 'results' && <section aria-label={tr(kind === 'shop' ? 'shops' : 'barbers')}>
          {mode === 'shop' && draft.branchId && <button type="button" className="cb-text-button" onClick={() => { patch({ branchId: '', barberId: '' }); setQuery(''); }}>{tr('changeShop')}</button>}
          <label className="cb-field-label" htmlFor="finder-search">{tr(mode === 'shop' && !draft.branchId ? 'searchShops' : 'searchBarbers')}</label><div className="cb-search"><Search size={22} aria-hidden="true" /><input id="finder-search" type="search" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); resetPage(); }} autoComplete="off" /></div>
          {loading ? <p className="cb-loading" role="status"><Loader2 className="cb-spinner" size={22} />{t('customerBooking.loading')}</p> : <><div className="bf-results">{items.map(item => <div key={item.id} className="cf-select-row"><button className="cb-option bf-result" type="button" data-provider-id={item.id} onClick={() => { if (kind === 'shop') { patch({ branchId: item.id, barberId: '' }); setQuery(''); } else select(item.id); }}><BookingImage src={kind === 'shop' ? item.image_url : item.avatar_url} name={name(item)} person={kind === 'barber'} /><span className="cb-option-copy"><strong>{name(item)}</strong>{kind === 'barber' && item.shop_name && <span>{shopWording(arabic && item.shop_name_ar ? item.shop_name_ar : item.shop_name)}</span>}<span>{cityName(item.city)}</span><CatalogRating rating={item.rating} /></span><ArrowRight size={20} aria-hidden="true" /></button><FavouriteButton kind={kind} targetId={item.id} name={name(item)} /></div>)}</div>
            {!items.length && !error && <p className="cb-empty" role="status">{tr(mode === 'time' ? 'noMatches' : 'noResults')}</p>}
            {(history.length>0 || next) && <nav className="bf-pagination" aria-label={tr('pages')}><button className="cb-secondary" type="button" disabled={!history.length} onClick={() => { setCursor(history.at(-1)); setHistory(value => value.slice(0,-1)); }}>{tr('previous')}</button><span>{tr('page', { number: history.length+1 })}</span><button className="cb-secondary" type="button" disabled={!next} onClick={() => { setHistory(value => [...value,cursor]); setCursor(next); }}>{tr('next')}</button></nav>}
          </>}
        </section>}
      </>}
      {stage === 'restore' && <p className="cb-loading" role="status"><Loader2 className="cb-spinner" size={22} />{t('customerBooking.loading')}</p>}
    </>}
  </main></div></div>;
}
