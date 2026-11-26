import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare2, ChevronDown, Search, Square } from 'lucide-react';
import './CitySelection.css';

const normalize = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/\u0640/g, '').toLocaleLowerCase().trim();

export default function CitySelection({ groups, selectedCities, cityName, governorateName, onApply, onEdit, actionLabel, disabled = false }) {
  const { t } = useTranslation();
  const tr = (key, values) => t(`bookingFinder.${key}`, values);
  const [groupKey, setGroupKey] = useState(() => groups.find(group => group.cities.includes(selectedCities[0]))?.key ?? '');
  const [pending, setPending] = useState(selectedCities);
  const [query, setQuery] = useState('');
  // Filters load asynchronously; derive the initial group without hiding restored selections.
  const group = groups.find(item => item.key === groupKey) ?? groups.find(item => item.cities.includes(pending[0])) ?? groups[0];
  const cities = group?.cities ?? [];
  const selection = pending.filter(city => cities.includes(city));
  const visible = cities.filter(city => normalize(cityName(city)).includes(normalize(query)) || normalize(city).includes(normalize(query)));
  const toggle = city => {
    onEdit?.();
    setPending(current => current.includes(city) ? current.filter(value => value !== city) : [...current.filter(value => cities.includes(value)), city]);
  };

  return <form className="cb-city-selection" onSubmit={event => { event.preventDefault(); if (selection.length && !disabled) onApply(selection); }}>
    <div className="cb-location-field">
      <label className="cb-field-label" htmlFor="booking-governorate">{t('customerBooking.governorateLabel')}</label>
      <div className="cb-governorate-control">
        <select id="booking-governorate" value={group?.key ?? ''} disabled={disabled || !groups.length}
          onChange={event => { onEdit?.(); setGroupKey(event.target.value); setPending([]); setQuery(''); }}>
          {groups.map(item => <option key={item.key} value={item.key}>{governorateName(item)}</option>)}
        </select>
        <ChevronDown size={20} aria-hidden="true" />
      </div>
    </div>
    <fieldset className="cb-city-choices" disabled={disabled}>
      <legend className="cb-field-label">{tr('citiesLabel')}</legend>
      <div className="cb-city-search">
        <Search size={20} aria-hidden="true" />
        <input id="booking-city" type="search" aria-label={tr('citiesLabel')} placeholder={tr('searchCities')} value={query}
          onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <div className="cb-city-checklist">
        {visible.map(city => <label key={city} className="cb-city-check-row">
          <input type="checkbox" checked={selection.includes(city)} onChange={() => toggle(city)} />
          {selection.includes(city) ? <CheckSquare2 className="cb-city-tick" size={22} aria-hidden="true" /> : <Square size={22} aria-hidden="true" />}
          <span>{cityName(city)}</span>
        </label>)}
        {!visible.length && <p className="cb-city-no-matches" role="status">{t(`customerBooking.${groups.length ? 'noCityMatches' : 'noCities'}`)}</p>}
      </div>
    </fieldset>
    <div className="cb-city-apply">
      <p aria-live="polite" aria-atomic="true">{tr('selectedCityCount', { count: selection.length })}</p>
      <button className="cb-primary" type="submit" disabled={disabled || !selection.length}>{actionLabel || tr('showShops')}</button>
    </div>
  </form>;
}
