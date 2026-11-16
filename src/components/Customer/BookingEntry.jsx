import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { customerBookingService } from '../../services/customerBooking.service';
import { bookingEntryDraft, hasBookingSelection } from '../../utils/bookingEntry';
import { readBookingDraft, readBookingReturnDraft, saveBookingDraft, saveBookingReceipt, forgetBookingReturn } from '../../utils/customerBookingDraft';

export default function BookingEntry({ target }) {
  const { t, i18n } = useTranslation();
  const { loading: authLoading } = useCustomerAuth();
  const navigate = useNavigate();
  const tr = key => t(`bookingEntry.${key}`);
  const [error, setError] = useState(target.invalid ? 'unavailable' : '');
  const [resolved, setResolved] = useState(null);
  const [retry, setRetry] = useState(0);
  const dialog = useRef(null);
  const enter = entry => {
    const draft = bookingEntryDraft(entry);
    // This is the only point where the previous journey is replaced, after
    // validation and explicit consent when another draft is in progress.
    forgetBookingReturn(); saveBookingReceipt(null); saveBookingDraft(draft);
    navigate('/book', { replace: true, state: { bookingDraft: draft } });
  };
  useEffect(() => {
    if (authLoading || target.invalid) return;
    let current = true; setError('');
    customerBookingService.entry(target).then(entry => {
      bookingEntryDraft(entry);
      if (!current) return;
      if (hasBookingSelection(readBookingReturnDraft() || readBookingDraft())) setResolved(entry);
      else enter(entry);
    }).catch(failure => { if (current) setError(failure.message === 'INVALID_SELECTION' ? 'unavailable' : 'error'); });
    return () => { current = false; };
  }, [target.kind, target.targetId, target.invalid, authLoading, retry]);
  useEffect(() => { if (resolved && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [resolved]);
  const keep = () => navigate('/book', { replace: true });
  return <div className="customer-booking bs-page" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}><main className="bs-main">
    {error ? <section className="bs-state"><h1>{tr(error === 'unavailable' ? 'unavailableTitle' : 'errorTitle')}</h1><p role="alert">{tr(error)}</p>
      <button className="cb-secondary" type="button" onClick={keep}>{tr('back')}</button>{error === 'error' && <button className="cb-secondary" type="button" onClick={() => setRetry(value => value + 1)}>{t('customerBooking.retry')}</button>}</section>
      : <p className="cb-loading" role="status"><Loader2 className="cb-spinner" size={24} aria-hidden="true" />{t('customerBooking.loading')}</p>}
    <dialog ref={dialog} className="bs-entry-dialog" aria-labelledby="booking-entry-title" aria-describedby="booking-entry-message" onCancel={event => { event.preventDefault(); keep(); }}>
      <h2 id="booking-entry-title">{tr('replaceTitle')}</h2><p id="booking-entry-message">{tr('replaceMessage')}</p>
      <div className="bs-entry-actions"><button className="cb-secondary" type="button" autoFocus onClick={keep}>{tr('keep')}</button><button className="cb-primary" type="button" onClick={() => enter(resolved)}>{tr('replace')}</button></div>
    </dialog>
  </main></div>;
}
