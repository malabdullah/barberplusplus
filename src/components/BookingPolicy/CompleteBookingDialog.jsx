import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../UI/Modal';
import { bookingsService } from '../../services/bookings.service';
import './BookingPolicy.css';
import './CompleteBookingDialog.css';

export default function CompleteBookingDialog({ bookingId, onClose, onConfirm }) {
  const { t, i18n } = useTranslation();
  const [payment, setPayment] = useState(null);
  const [method, setMethod] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef(null);
  const tr = key => t(`bookingCompletion.${key}`);
  const message = useCallback(failure => t(`bookingCompletion.${['BOOKING_NOT_FINISHED', 'COMPLETION_NOT_CONFIRMED', 'COMPLETION_PAYMENT_CHANGED', 'COMPLETION_FORBIDDEN'].includes(failure.message) ? failure.message : 'error'}`), [t]);
  useEffect(() => {
    let current = true;
    bookingsService.completionPayment(bookingId).then(result => {
      if (current) setPayment(result);
    }).catch(failure => { if (current) setError(message(failure)); });
    return () => { current = false; };
  }, [bookingId, message]);
  useEffect(() => { if (payment) form.current?.querySelector('select, button')?.focus(); }, [payment]);
  const close = () => { if (!busy) onClose(); };
  const due = Number(payment?.dueFils || 0);
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'KWD' }).format(due / 1000);
  async function submit(event) {
    event.preventDefault();
    if (busy || !payment || due > 0 && !method) return;
    setBusy(true); setError('');
    try { await onConfirm(method || null, payment.dueFils); }
    catch (failure) {
      setError(message(failure));
      if (failure.message === 'COMPLETION_PAYMENT_CHANGED') {
        try { setPayment(await bookingsService.completionPayment(bookingId)); setMethod(''); }
        catch { setPayment(null); }
      }
      setBusy(false);
    }
  }
  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [...form.current.querySelectorAll('select, button')].filter(control => !control.disabled);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <Modal isOpen onClose={close} title={tr('title')}>
    <form ref={form} className="complete-booking-form" role="dialog" aria-modal="true" aria-label={tr('title')} onSubmit={submit} onKeyDown={trapFocus}>
      {!payment && !error && <p role="status">{t('common.loading')}</p>}
      {payment && (due > 0 ? <>
        <div className="complete-booking-amount"><span>{tr('remaining')}</span><strong>{money}</strong></div>
        <label htmlFor="completion-method">{tr('method')}</label>
        <select id="completion-method" className="form-select" value={method} onChange={event => setMethod(event.target.value)} required disabled={busy}>
          <option value="">{tr('choose')}</option>
          {['cash', 'card', 'transfer', 'other', 'unpaid'].map(value => <option key={value} value={value}>{tr(value)}</option>)}
        </select>
      </> : <p>{tr(payment.onlinePaid ? 'online' : 'noBalance')}</p>)}
      {error && <p role="alert">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy || !payment || due > 0 && !method}>{tr(busy ? 'saving' : 'complete')}</button>
      </div>
    </form>
  </Modal>;
}
