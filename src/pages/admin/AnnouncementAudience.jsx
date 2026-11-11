import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { adminPushService } from '../../services/adminPush.service';

export default function AnnouncementAudience(
  { filters, setFilters, busy, run, pager },
) {
  const { t } = useTranslation();
  const tr = (key, values) => t(`announcements.${key}`, values);
  const [saved, setSaved] = useState({ audiences: [], total: 0 });
  const [savedPage, setSavedPage] = useState(1);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('');
  const [barbers, setBarbers] = useState({ barbers: [], total: 0 });
  const [barberPage, setBarberPage] = useState(1);
  const [query, setQuery] = useState('');
  const [names, setNames] = useState({});
  const change = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const loadSaved = async (page = 1) => {
    setSaved(await adminPushService.audiences(page));
    setSavedPage(page);
  };
  useEffect(() => {
    run(() => loadSaved());
  }, []);
  const searchBarbers = (page = 1) =>
    run(async () => {
      setBarbers(await adminPushService.barbers(page, query));
      setBarberPage(page);
    });
  return (
    <>
      <section className='ann-presets' aria-label={tr('savedAudiences')}>
        <div className='ann-field'>
          <label htmlFor='ann-saved-audience'>{tr('savedAudiences')}</label>
          <select
            id='ann-saved-audience'
            className='form-input'
            value={preset}
            disabled={busy}
            onChange={(e) => setPreset(e.target.value)}
          >
            <option value=''>{tr('chooseSaved')}</option>
            {saved.audiences.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className='ann-row-actions'>
          <button
            className='btn btn-secondary'
            disabled={busy || !preset}
            onClick={() => {
              const audience = saved.audiences.find((a) => a.id === preset);
              if (audience) {
                setFilters((current) => ({
                  ...Object.fromEntries(
                    Object.entries(current).map((
                      [key, value],
                    ) => [
                      key,
                      Array.isArray(value)
                        ? []
                        : typeof value === 'boolean'
                        ? false
                        : '',
                    ]),
                  ),
                  ...audience.filters,
                }));
              }
            }}
          >
            {tr('applyAudience')}
          </button>
          <button
            className='ann-text'
            disabled={busy || !preset}
            onClick={() =>
              run(async () => {
                await adminPushService.deleteAudience(preset);
                setPreset('');
                await loadSaved();
              })}
          >
            {tr('deleteAudience')}
          </button>
        </div>
        {saved.total > 25 &&
          pager(savedPage, saved.total, (page) => run(() => loadSaved(page)))}
        <form
          className='ann-search'
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const criteria = Object.fromEntries(
                Object.entries(filters).filter(([key]) =>
                  !['userIds', 'excludeIds'].includes(key)
                ),
              );
              await adminPushService.saveAudience(name.trim(), criteria);
              setName('');
              await loadSaved();
            });
          }}
        >
          <label className='sr-only' htmlFor='ann-preset-name'>
            {tr('audienceName')}
          </label>
          <input
            id='ann-preset-name'
            className='form-input'
            placeholder={tr('audienceName')}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button className='btn btn-secondary' disabled={busy || !name.trim()}>
            {tr('saveAudience')}
          </button>
        </form>
      </section>
      <details className='ann-advanced'>
        <summary>{tr('bookingActivity')}</summary>
        <div className='ann-filters'>
          <label className='ann-checkbox ann-full'>
            <input
              type='checkbox'
              checked={filters.noBookings || false}
              disabled={busy}
              onChange={(e) => {
                if (e.target.checked) {
                  setFilters((f) => ({
                    roles: f.roles,
                    noBookings: true,
                  }));
                } else change('noBookings', false);
              }}
            />
            {tr('noBookings')}
          </label>
          {!filters.noBookings && (
            <>
              <fieldset className='ann-roles ann-full'>
                <legend>{tr('bookingStatuses')}</legend>
                {['pending', 'confirmed', 'completed', 'cancelled', 'no_show']
                  .map((status) => (
                    <label key={status}>
                      <input
                        type='checkbox'
                        disabled={busy}
                        checked={(filters.bookingStatuses || []).includes(
                          status,
                        )}
                        onChange={(e) =>
                          change(
                            'bookingStatuses',
                            e.target.checked
                              ? [...(filters.bookingStatuses || []), status]
                              : filters.bookingStatuses.filter((s) =>
                                s !== status
                              ),
                          )}
                      />
                      {tr(`bookingStatus.${status}`)}
                    </label>
                  ))}
              </fieldset>
              {['minCompleted', 'maxCompleted'].map((key) => (
                <div key={key} className='ann-field'>
                  <label htmlFor={`ann-${key}`}>{tr(key)}</label>
                  <input
                    id={`ann-${key}`}
                    className='form-input'
                    type='number'
                    min='0'
                    max='100000'
                    step='1'
                    disabled={busy}
                    value={filters[key] || ''}
                    onChange={(e) =>
                      change(key, e.target.value)}
                  />
                </div>
              ))}
              <div className='ann-field'>
                <label htmlFor='ann-last-visit'>{tr('lastVisitBefore')}</label>
                <input
                  id='ann-last-visit'
                  type='date'
                  className='form-input'
                  disabled={busy}
                  value={filters.lastVisitBefore || ''}
                  onChange={(e) => change('lastVisitBefore', e.target.value)}
                />
              </div>
              <details className='ann-shop-picker ann-full'>
                <summary>
                  {tr('barbers', { count: (filters.barberIds || []).length })}
                </summary>
                <form
                  className='ann-search'
                  onSubmit={(e) => {
                    e.preventDefault();
                    searchBarbers();
                  }}
                >
                  <label className='sr-only' htmlFor='ann-barber-query'>
                    {tr('searchBarbers')}
                  </label>
                  <input
                    id='ann-barber-query'
                    className='form-input'
                    placeholder={tr('searchBarbers')}
                    maxLength={120}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button className='btn btn-secondary' disabled={busy}>
                    <Search size={17} />
                    {tr('search')}
                  </button>
                </form>
                <div className='ann-shop-list'>
                  {barbers.barbers.map((b) => (
                    <label key={b.id}>
                      <input
                        type='checkbox'
                        checked={(filters.barberIds || []).includes(b.id)}
                        disabled={busy}
                        onChange={(e) => {
                          change(
                            'barberIds',
                            e.target.checked
                              ? [...(filters.barberIds || []), b.id]
                              : filters.barberIds.filter((id) => id !== b.id),
                          );
                          setNames((n) => ({ ...n, [b.id]: b.name }));
                        }}
                      />
                      <span>
                        {b.name}
                        <small>{b.shopName}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {pager(barberPage, barbers.total, searchBarbers)}
                <div className='ann-chips'>
                  {(filters.barberIds || []).map((id) => (
                    <button
                      key={id}
                      disabled={busy}
                      onClick={() =>
                        change(
                          'barberIds',
                          filters.barberIds.filter((b) => b !== id),
                        )}
                    >
                      {names[id] || tr('barber')}
                      <X size={14} />
                    </button>
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      </details>
    </>
  );
}
