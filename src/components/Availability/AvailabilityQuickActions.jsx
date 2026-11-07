import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { availabilityService } from '../../services/availability.service';
import { getErrorMessage } from '../../utils/errorMessages';
import { AvailabilityItemEditor } from './AvailabilityItem';

export default function AvailabilityQuickActions({ item, onDecided }) {
  const { t } = useTranslation();
  const reasonId = useId();
  const lock = useRef(false);
  const [mode, setMode] = useState(null);
  const [value, setValue] = useState(item.requested_value);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [checkedValue, setCheckedValue] = useState(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (mode !== 'modify') return;
    let current = true;
    setCheckedValue(null); setChecking(true); setError(null); setConflicts([]);
    const timer = setTimeout(() => {
      availabilityService.call('preview', { request_id: item.id, value })
        .then(result => { if (current) { setConflicts(result.conflicts || []); setCheckedValue(JSON.stringify(value)); } })
        .catch(failure => { if (current) setError(failure); })
        .finally(() => { if (current) setChecking(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [mode, item.id, value]);
  const decide = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = await availabilityService.call(action, { request_id: item.id, value, note: action === 'decline' ? note.trim() : '' });
      if (result.blocked) { setConflicts(result.conflicts || []); return; }
      onDecided(item.id, action === 'approve' ? 'approved' : 'declined');
    } catch (failure) { setError(failure); }
    finally { lock.current = false; setBusy(false); }
  };
  const toggle = next => { setMode(previous => previous === next ? null : next); setValue(item.requested_value); setError(null); setCheckedValue(null); };
  return <div className="availability-quick-review" aria-busy={busy}>
    <div className="availability-quick-actions">
      <button className="btn btn-primary" disabled={busy || mode === 'modify' || conflicts.length > 0} onClick={() => decide('approve')}>{t('availabilityItems.approve')}</button>
      {item.requested_value && <button className="btn btn-secondary" aria-expanded={mode === 'modify'} disabled={busy} onClick={() => toggle('modify')}>{t('availabilityItems.modify')}</button>}
      <button className="btn availability-decline-action" aria-expanded={mode === 'decline'} disabled={busy} onClick={() => toggle('decline')}>{t('availabilityItems.decline')}</button>
    </div>
    {error && <p className="form-error" role="alert">{getErrorMessage(error, t('common.error'), t)}</p>}
    {conflicts.length > 0 && <section className="availability-conflicts" role="alert"><h3>{t('availabilityApproval.blockedTitle', { count: conflicts.length })}</h3>
      <ul>{conflicts.map(booking => <li key={booking.id}><div><strong>{booking.customer_name}</strong><p>{booking.date} · {booking.time} · {booking.duration} {t('common.min')}</p></div>
        <Link className="btn btn-secondary" to={`/dashboard/bookings?booking=${booking.id}&reviewBarber=${item.barber_id}&reviewRequest=${item.id}`}>{t('availabilityApproval.resolveBooking')}</Link></li>)}</ul>
      {mode !== 'modify' && <button className="btn btn-secondary" disabled={busy} onClick={() => { setConflicts([]); setCheckedValue(null); }}>{t('availabilityApproval.reload')}</button>}
    </section>}
    {mode === 'modify' && <div className="availability-inline-editor">
      <AvailabilityItemEditor item={item} value={value} onChange={setValue} disabled={busy} />
      {checking && <p role="status">{t('availabilityApproval.checking')}</p>}
      <div className="availability-inline-actions"><button className="btn btn-primary" disabled={busy || checking || checkedValue !== JSON.stringify(value) || conflicts.length > 0 || Boolean(error)} onClick={() => decide('approve')}>{t('availabilityItems.approveModified')}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => toggle('modify')}>{t('common.cancel')}</button></div>
    </div>}
    {mode === 'decline' && <form className="availability-inline-decline" onSubmit={event => { event.preventDefault(); if (note.trim().length >= 3) decide('decline'); }}>
      <label htmlFor={reasonId}>{t('availabilityItems.declineReason')}</label>
      <textarea autoFocus id={reasonId} className="form-input" required minLength={3} maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
      <div className="availability-inline-actions"><button className="btn btn-danger" disabled={busy || note.trim().length < 3}>{t('availabilityItems.decline')}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => toggle('decline')}>{t('common.cancel')}</button></div>
    </form>}
  </div>;
}
