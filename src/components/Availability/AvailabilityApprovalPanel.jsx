import React from 'react';
import { availabilityItemSummary } from './AvailabilityItem';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '../../utils/errorMessages';
import './AvailabilityApproval.css';

export function AvailabilitySummary({ value }) {
  const { t, i18n } = useTranslation();
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const dayName = key => new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2024, 0, 1 + days.indexOf(key))));
  return <div className="availability-review-summary">
    <ul>{days.map(day => { const hours = value?.availability?.[day]; return <li key={day}>
      <strong>{dayName(day)}</strong> <span dir="ltr">{(hours?.enabled ?? hours?.available) ? `${hours.start}–${hours.end}` : t('availability.dayOff')}</span>
    </li>; })}</ul>
    <h4>{t('availability.timeOff')}</h4>
    {value?.time_offs?.length ? <ul>{value.time_offs.map((item, index) => <li key={item.id || index}>
      <span>{item.type === 'recurring' ? dayName(item.day) : item.date}</span> <span dir="ltr">{item.start}–{item.end}</span>
    </li>)}</ul> : <p>{t('availabilityApproval.none')}</p>}
    <h4>{t('availability.vacations')}</h4>
    {value?.vacations?.length ? <ul>{value.vacations.map((item, index) => <li key={item.id || index}><bdi dir="ltr">{item.startDate} – {item.endDate}</bdi>{item.reason && ` · ${item.reason}`}</li>)}</ul> : <p>{t('availabilityApproval.none')}</p>}
  </div>;
}
export default function AvailabilityApprovalPanel({ approval, manager, barberId }) {
  const { t } = useTranslation();
  const itemSummary = item => {
    const value = item.status === 'approved' ? item.approved_value : item.requested_value;
    if (item.category === 'break' && value) return <><bdi>{value.type === 'recurring' ? t(`days.${value.day}`) : value.date}</bdi> · <bdi dir="ltr">{value.start}–{value.end}</bdi></>;
    return <bdi dir={item.category === 'vacation' && value ? 'ltr' : undefined}>{availabilityItemSummary(item, t)}</bdi>;
  };
  return <section className={`availability-approval-panel ${manager ? '' : 'availability-barber-requests'}`} aria-label={t(manager ? 'availabilityApproval.title' : 'availabilityCompact.requests')}>
    {manager ? <><h3>{t('availabilityApproval.title')}</h3><p>{t('availabilityApproval.managerHelp')}</p></> : <header className="availability-barber-request-heading"><h3>{t('availabilityCompact.requests')}</h3><button className="btn btn-secondary" onClick={approval.reload} disabled={approval.busy}>{t('availabilityItems.refresh')}</button></header>}
    {approval.notice && <p role="status">{t(`${manager ? 'availabilityApproval' : 'availabilityCompact'}.${approval.notice}`)}</p>}
    {approval.error && <p role="alert" className="form-error">{getErrorMessage(approval.error, t('common.error'), t)}</p>}
    {approval.pendingItems.length > 0 && <div className="availability-person-items"><h4>{t('availabilityItems.pending')} ({approval.pendingItems.length})</h4><ul>
      {approval.pendingItems.map(item => <li key={item.id}><strong>{t(`availabilityItems.${item.category}`)}</strong><span>{itemSummary(item)}</span>
        {manager && <Link to={`/dashboard/availability-requests/${item.id}`}>{t('availabilityApproval.review')}</Link>}</li>)}
    </ul></div>}
    {!manager && approval.detail?.requests.some(item => ['approved','declined'].includes(item.status)) && <details><summary>{t('availabilityCompact.history')}</summary><ul className="availability-decision-history">
      {approval.detail.requests.filter(item => ['approved','declined'].includes(item.status)).map(item => <li key={item.id}><strong>{t(`availabilityItems.${item.category}`)} · {t(`availabilityItems.${item.status}`)}</strong><p>{itemSummary(item)}</p>{item.review_note && <p>{item.review_note}</p>}</li>)}
    </ul></details>}
    {(manager || approval.detail?.barber.availability_approved_at) && <details><summary>{t(manager ? 'availabilityApproval.approvedCurrently' : 'availabilityCompact.approvedSchedule')}</summary>
      <AvailabilitySummary value={{ availability: approval.detail?.barber.availability,
        time_offs: approval.detail?.barber.time_offs, vacations: approval.detail?.barber.vacations }} />
    </details>}
    {manager && <>
      {approval.checking && <p role="status">{t('availabilityApproval.checking')}</p>}
      {approval.conflicts.length > 0 && <div className="availability-conflicts" role="alert">
        <h4>{t('availabilityApproval.blockedTitle', { count: approval.conflicts.length })}</h4>
        <p>{t('availabilityApproval.blockedHelp')}</p>
        <ul>{approval.conflicts.map(booking => <li key={booking.id}>
          <div><strong>{booking.customer_name || t('bookings.addedBy.customer')}</strong>
            <p>{booking.date} · {booking.time} · {booking.duration} {t('common.min')}</p></div>
          <Link className="btn btn-secondary" to={`/dashboard/bookings?booking=${booking.id}&reviewBarber=${barberId}${approval.review ? `&reviewRequest=${approval.review.id}` : ''}`}>
            {t('availabilityApproval.resolveBooking')}</Link>
        </li>)}</ul>
      </div>}
    </>}
    {manager && <button className="btn btn-secondary" onClick={approval.reload} disabled={approval.busy}>{t('availabilityApproval.reload')}</button>}
  </section>;
}
