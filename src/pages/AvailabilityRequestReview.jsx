import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { availabilityService } from '../services/availability.service';
import { AvailabilityItemEditor, AvailabilityItemValue } from '../components/Availability/AvailabilityItem';
import { getErrorMessage } from '../utils/errorMessages';
import '../components/Availability/AvailabilityApproval.css';
export default function AvailabilityRequestReview() {
  const { requestId } = useParams();
  const { t, i18n } = useTranslation();
  const { reloadData, barbers, branches } = useApp();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [value, setValue] = useState(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [checkedValue, setCheckedValue] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [notice, setNotice] = useState(null);
  const item = detail?.selected_request;
  useEffect(() => { setNotice(null); }, [requestId]);
  useEffect(() => {
    let current = true; setLoading(true); setDetail(null); setError(null); setConflicts([]); setEditing(false); setNote(''); setCheckedValue(null);
    availabilityService.call('get', { request_id: requestId }).then(result => { if (current) { setDetail(result); setValue(result.selected_request?.requested_value || null); } })
      .catch(failure => { if (current) setError(failure); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [requestId, refresh]);
  useEffect(() => {
    if (!item || item.category === 'legacy' || item.status !== 'pending') return;
    let current = true; setChecking(true); setPreviewError(null); setConflicts([]); setCheckedValue(null);
    const timer = setTimeout(() => {
      availabilityService.call('preview', { request_id: item.id, value }).then(result => { if (current) { setConflicts(result.conflicts || []); setCheckedValue(`${item.id}:${JSON.stringify(value)}`); } })
        .catch(failure => { if (current) setPreviewError(failure); }).finally(() => { if (current) setChecking(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [item, value]);
  const decide = async action => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await availabilityService.call(action, { request_id: item.id, value, note });
      if (result.blocked) { setConflicts(result.conflicts); return; }
      setNotice(action === 'approve' ? 'approved' : 'declined');
      await reloadData(); setRefresh(previous => previous + 1);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  const pending = item?.status === 'pending';
  const barber = barbers.find(person => person.id === detail?.barber.id);
  const shop = branches.find(branch => branch.id === detail?.barber.branch_id);
  return <div className="availability-item-review">
    <Link className="availability-back" to="/dashboard/availability-requests">{t('availabilityItems.back')}</Link>
    {loading && <p role="status">{t('common.loading')}</p>}
    {error && <p className="form-error" role="alert">{getErrorMessage(error, t('common.error'), t)}</p>}
    {notice && <p className="availability-decision-notice" role="status">{t(`availabilityItems.${notice}Notice`)}</p>}
    {!loading && !detail && <button className="btn btn-secondary" onClick={() => setRefresh(previous => previous + 1)}>{t('availabilityApproval.reload')}</button>}
    {item && <>
      <header className="page-header"><div><p className="availability-item-type">{t(`availabilityItems.${item.category}`)}</p>
        <h1 className="page-title">{barber?.name || detail.barber.name}</h1><p>{shop?.name}</p><p>{t(`availabilityItems.${item.status}`)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(item.created_at))}</p></div>
        <button className="btn btn-secondary" disabled={busy} onClick={() => setRefresh(previous => previous + 1)}>{t('availabilityApproval.reload')}</button>
      </header>
      {item.category === 'legacy' ? <section className="availability-approval-panel"><p>{t('availabilityItems.legacyHelp')}</p>{detail.related_items.map(related => <p key={related.id}><Link to={`/dashboard/availability-requests/${related.id}`}>{t(`availabilityItems.${related.category}`)} · {t(`availabilityItems.${related.status}`)}</Link></p>)}</section> : <>
        <p>{t('availabilityItems.independentHelp')}</p>
        <div className="availability-item-comparison"><section><h2>{t('availabilityItems.previous')}</h2><AvailabilityItemValue category={item.category} value={item.base_value} /></section>
          <section><h2>{t(item.requested_value ? 'availabilityItems.requested' : 'availabilityItems.removal')}</h2>{item.requested_value ? <AvailabilityItemValue category={item.category} value={item.requested_value} /> : <p>{t('availabilityItems.remove')}</p>}</section>
          {item.status === 'approved' && <section><h2>{t('availabilityItems.approvedResult')}</h2><AvailabilityItemValue category={item.category} value={item.approved_value} /></section>}
        </div>
        {item.review_note && <div className="availability-approval-panel"><h2>{t('availabilityItems.reviewNote')}</h2><p>{item.review_note}</p></div>}
        {pending && <>
          {editing && <AvailabilityItemEditor item={item} value={value} onChange={setValue} disabled={busy} />}
          {previewError && <p className="form-error" role="alert">{getErrorMessage(previewError, t('common.error'), t)}</p>}
          {checking && <p role="status">{t('availabilityApproval.checking')}</p>}
          {conflicts.length > 0 && <section className="availability-conflicts" role="alert"><h2>{t('availabilityApproval.blockedTitle', { count: conflicts.length })}</h2><p>{t('availabilityItems.blockedHelp')}</p>
            <ul>{conflicts.map(booking => <li key={booking.id}><div><strong>{booking.customer_name}</strong><p>{booking.date} · {booking.time} · {booking.duration} {t('common.min')}</p></div>
              <Link className="btn btn-secondary" to={`/dashboard/bookings?booking=${booking.id}&reviewBarber=${item.barber_id}&reviewRequest=${item.id}`}>{t('availabilityApproval.resolveBooking')}</Link></li>)}</ul>
          </section>}
          <section className="availability-item-decision"><label htmlFor="availability-decision-note">{t('availabilityItems.decisionNote')}</label><textarea id="availability-decision-note" className="form-input" maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
            <p>{t('availabilityItems.declineReasonHelp')}</p>
            <div className="page-actions">
              <button className="btn btn-primary" disabled={busy || checking || checkedValue !== `${item.id}:${JSON.stringify(value)}` || Boolean(previewError) || conflicts.length > 0} onClick={() => decide('approve')}>{t(editing ? 'availabilityItems.approveModified' : 'availabilityItems.approve')}</button>
              {item.requested_value && <button className="btn btn-secondary" disabled={busy} onClick={() => { setEditing(previous => !previous); setValue(item.requested_value); }}>{t(editing ? 'availabilityItems.discardEdit' : 'availabilityItems.modify')}</button>}
              <button className="btn btn-danger" disabled={busy || note.trim().length < 3} onClick={() => decide('decline')}>{t('availabilityItems.decline')}</button>
            </div>
          </section>
        </>}
      </>}
    </>}
  </div>;
}
