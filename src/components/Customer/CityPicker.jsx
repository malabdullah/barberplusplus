import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import './CityPicker.css';

const normalize = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/\u0640/g, '').toLocaleLowerCase().trim();

export default function CityPicker({ groups, value, onChange, selectedCities, cityName, governorateName, disabled = false }) {
  const { t } = useTranslation();
  const tr = key => t(`customerBooking.${key}`);
  const multiple = Array.isArray(selectedCities);
  const selection = selectedCities ?? (value ? [value] : []);
  const label = multiple ? t('bookingFinder.citiesLabel') : tr('cityLabel');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const search = normalize(query);
  const visibleGroups = groups.map(group => ({
    ...group,
    cities: group.cities.filter(city => normalize(`${cityName(city)} ${city} ${governorateName(group)}`).includes(search)),
  })).filter(group => group.cities.length);
  const options = visibleGroups.flatMap(group => group.cities);
  const close = () => { setOpen(false); setQuery(''); };
  const show = () => {
    setQuery('');
    setActive(Math.max(0, groups.flatMap(group => group.cities).indexOf(selection[0])));
    setOpen(true);
  };
  const choose = city => {
    if (multiple) {
      setQuery('');
      setActive(groups.flatMap(group => group.cities).indexOf(city));
    }
    else close();
    onChange(city);
  };

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    // Scroll only this list, without moving the page or the mobile keyboard.
    const option = document.getElementById(`booking-city-option-${active}`);
    if (!open || !option || !list.current) return;
    const row = option.getBoundingClientRect();
    const box = list.current.getBoundingClientRect();
    if (row.top < box.top) list.current.scrollTop -= box.top - row.top;
    else if (row.bottom > box.bottom) list.current.scrollTop += row.bottom - box.bottom;
  }, [open, active, query]);

  const onKeyDown = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { show(); return; }
      if (options.length) setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) show();
      else if (options[active]) choose(options[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab' && !multiple) close();
  };

  const citySeparator = t('bookingFinder.citySeparator');
  let optionIndex = 0;
  return <div className="cb-city-picker" ref={root} onKeyDown={event => { if (multiple && event.key === 'Escape' && event.target !== input.current) { input.current?.focus(); close(); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <label className="cb-field-label" htmlFor="booking-city">{label}</label>
    <div className={`cb-select-wrap cb-city-control ${open ? 'is-open' : ''}`} onClick={() => { if (!disabled) { input.current?.focus(); if (!open) show(); } }}>
      <MapPin size={20} aria-hidden="true" />
      <input ref={input} id="booking-city" role="combobox" type="text" autoComplete="off" spellCheck={false}
        aria-autocomplete="list" aria-expanded={open} aria-controls={open ? 'booking-city-list' : undefined} aria-required="true"
        aria-activedescendant={open && options[active] ? `booking-city-option-${active}` : undefined}
        disabled={disabled} value={open ? query : selection.map(city => cityName(city)).join(citySeparator)}
        placeholder={tr(open ? 'citySearch' : 'cityPlaceholder')}
        onFocus={show} onKeyDown={onKeyDown}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }} />
      <ChevronDown className={open ? 'is-open' : ''} size={18} aria-hidden="true" />
    </div>
    {open && <div className="cb-city-menu" onMouseDown={event => event.preventDefault()}>
      {multiple && <div className="cb-city-menu-actions"><span>{t('bookingFinder.citySelectionHint')}</span><button type="button" className="cb-text-button" onClick={close}>{t('bookingFinder.doneCities')}</button></div>}
      <div className="cb-city-list" id="booking-city-list" role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} ref={list}>
        {visibleGroups.map(group => <div key={group.key} role="group" aria-label={governorateName(group)}>
          <div className="cb-city-group-heading">
            {group.key !== 'other' && <span>{tr('governorateLabel')}</span>}
            <strong>{governorateName(group)}</strong>
          </div>
          {group.cities.map(city => {
            const index = optionIndex++;
            const selected = selection.includes(city);
            return <div key={city} id={`booking-city-option-${index}`} role="option" data-city={city} aria-selected={selected}
              className={`cb-city-option ${index === active ? 'is-active' : ''}`}
              onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(city)}>
              <span>{cityName(city)}</span>{selected && <Check size={18} aria-hidden="true" />}
            </div>;
          })}
        </div>)}
      </div>
      {!options.length && <p className="cb-city-empty" role="status">{tr('noCityMatches')}</p>}
    </div>}
  </div>;
}
