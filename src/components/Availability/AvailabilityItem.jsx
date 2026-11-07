import React from 'react';
import { useTranslation } from 'react-i18next';
import { DAYS } from '../../constants/time';

export function AvailabilityItemValue({ category, value }) {
  const { t } = useTranslation();
  if (!value) return <p>{t('availabilityItems.notSet')}</p>;
  if (category === 'hours') return <><dl className="availability-hours-list">{DAYS.map(({ key }) => {
    const day = value.availability?.[key];
    return <div key={key}><dt>{t(`days.${key}`)}</dt><dd>{day?.enabled ? `${day.start}–${day.end}` : t('availability.dayOff')}</dd></div>;
  })}</dl><p>{t('availabilityItems.bookingWindow', { count: value.max_booking_days })}</p></>;
  if (category === 'break') return <><p><strong>{value.type === 'recurring' ? t('availabilityItems.everyDay', { day: t(`days.${value.day}`) }) : value.date}</strong></p><p dir="ltr">{value.start}–{value.end}</p>{value.reason && <p>{value.reason}</p>}</>;
  return <><p dir="ltr">{value.startDate} – {value.endDate}</p>{value.reason && <p>{value.reason}</p>}</>;
}
export function availabilityItemSummary(item, t) {
  const value = item.status === 'approved' ? item.approved_value : item.requested_value;
  if (!value) return t('availabilityItems.remove');
  if (item.category === 'hours') return t('availabilityItems.bookingWindow', { count: value.max_booking_days });
  if (item.category === 'break') return `${value.type === 'recurring' ? t(`days.${value.day}`) : value.date} · ${value.start}–${value.end}`;
  return `${value.startDate} – ${value.endDate}`;
}
export function AvailabilityItemEditor({ item, value, onChange, disabled }) {
  const { t } = useTranslation();
  const change = (field, next) => onChange({ ...value, [field]: next });
  if (!value) return null;
  if (item.category === 'hours') return <fieldset disabled={disabled} className="availability-item-editor"><legend>{t('availabilityItems.modifyHours')}</legend>
    {DAYS.map(({ key }) => { const day = value.availability[key]; const update = patch => onChange({ ...value, availability: { ...value.availability, [key]: { ...day, ...patch } } });
      return <div className="availability-hour-editor" key={key}>
        <label className="availability-day-toggle"><input type="checkbox" checked={day.enabled} onChange={event => update({ enabled: event.target.checked })} />{t(`days.${key}`)}</label>
        <input type="time" className="form-input" value={day.start} disabled={!day.enabled} aria-label={`${t(`days.${key}`)} — ${t('availability.from')}`} onChange={event => update({ start: event.target.value })} />
        <input type="time" className="form-input" value={day.end} disabled={!day.enabled} aria-label={`${t(`days.${key}`)} — ${t('availability.toTime')}`} onChange={event => update({ end: event.target.value })} />
      </div>;
    })}<label>{t('availability.bookingWindow')}<input className="form-input" type="number" min="1" max="365" value={value.max_booking_days} onChange={event => change('max_booking_days', Number(event.target.value))} /></label>
  </fieldset>;
  return <fieldset disabled={disabled} className="availability-item-editor"><legend>{t('availabilityItems.modify')}</legend>
    {item.category === 'break' ? <>
      <label>{t('availability.type')}<select className="form-select" value={value.type} onChange={event => onChange({ ...value, type: event.target.value, day: value.day || 'monday', date: value.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date()) })}>
        <option value="recurring">{t('availability.recurringWeekly')}</option><option value="one-time">{t('availability.oneTimeOnly')}</option>
      </select></label>
      {value.type === 'recurring' ? <label>{t('availability.day')}<select className="form-select" value={value.day || 'monday'} onChange={event => change('day', event.target.value)}>{DAYS.map(({ key }) => <option key={key} value={key}>{t(`days.${key}`)}</option>)}</select></label>
        : <label>{t('availability.date')}<input className="form-input" type="date" value={value.date || ''} onChange={event => change('date', event.target.value)} /></label>}
      <div className="availability-item-two-fields"><label>{t('availability.from')}<input className="form-input" type="time" value={value.start} onChange={event => change('start', event.target.value)} /></label>
      <label>{t('availability.toTime')}<input className="form-input" type="time" value={value.end} onChange={event => change('end', event.target.value)} /></label></div>
    </> : <div className="availability-item-two-fields"><label>{t('availability.fromDate')}<input className="form-input" type="date" value={value.startDate} onChange={event => change('startDate', event.target.value)} /></label>
      <label>{t('availability.toDate')}<input className="form-input" type="date" value={value.endDate} onChange={event => change('endDate', event.target.value)} /></label></div>}
    <label>{t('availabilityItems.reason')}<input className="form-input" maxLength={300} value={value.reason || ''} onChange={event => change('reason', event.target.value)} /></label>
  </fieldset>;
}
