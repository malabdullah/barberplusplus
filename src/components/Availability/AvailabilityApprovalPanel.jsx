import React, { useState } from 'react';
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
      <strong>{dayName(day)}</strong> <span>{(hours?.enabled ?? hours?.available) ? `${hours.start}–${hours.end}` : t('availability.dayOff')}</span>
    </li>; })}</ul>
    <h4>{t('availability.timeOff')}</h4>
    {value?.time_offs?.length ? <ul>{value.time_offs.map((item, index) => <li key={item.id || index}>
      <span>{item.type === 'recurring' ? dayName(item.day) : item.date}</span> <span>{item.start}–{item.end}</span>
    </li>)}</ul> : <p>{t('availabilityApproval.none')}</p>}
    <h4>{t('availability.vacations')}</h4>
    {value?.vacations?.length ? <ul>{value.vacations.map((item, index) => <li key={item.id || index}>{item.startDate} – {item.endDate}{item.reason && ` · ${item.reason}`}</li>)}</ul> : <p>{t('availabilityApproval.none')}</p>}
  </div>;
}
export default function AvailabilityApprovalPanel({ approval, manager, barberId }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const latest = approval.detail?.requests[0];
  return <section className="availability-approval-panel" aria-label={t('availabilityApproval.title')}>
    <h3>{t('availabilityApproval.title')}</h3>
    <p>{t(manager ? 'availabilityApproval.managerHelp' : 'availabilityApproval.barberHelp')}</p>
    {approval.notice && <p role="status">{t(`availabilityApproval.${approval.notice}`)}</p>}
    {approval.error && <p role="alert" className="form-error">{getErrorMessage(approval.error, t('common.error'), t)}</p>}
    {approval.pending && <p className="alert alert-info">{t('availabilityApproval.pending')}</p>}
    {latest?.status === 'declined' && <p role="status">{t('availabilityApproval.declined')}: {latest.review_note}</p>}
    {approval.selected && approval.selected.status !== 'pending' && <p>{t('availabilityApproval.reviewedAlready')}</p>}
    <details><summary>{t('availabilityApproval.approvedCurrently')}</summary>
      <AvailabilitySummary value={{ availability: approval.detail?.barber.availability,
        time_offs: approval.detail?.barber.time_offs, vacations: approval.detail?.barber.vacations }} />
    </details>
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
      {approval.review && <div className="availability-decline">
        <label htmlFor="availability-review-note">{t('availabilityApproval.reason')}</label>
        <textarea id="availability-review-note" className="form-input" maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
        <button className="btn btn-danger" disabled={approval.busy || note.trim().length < 3} onClick={() => approval.decide('decline', note)}>{t('availabilityApproval.decline')}</button>
      </div>}
    </>}
    <button className="btn btn-secondary" onClick={approval.reload} disabled={approval.busy}>{t('availabilityApproval.reload')}</button>
  </section>;
}
