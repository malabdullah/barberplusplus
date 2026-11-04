import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../UI/Modal';
import './BookingPolicy.css';

export default function StaffCancelBookingDialog({ booking, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tr = key => t(`bookingPolicy.${key}`);
  const close = () => { if (!busy) onClose(); };
  async function submit(event) {
    event.preventDefault();
    if (busy || reason.trim().length < 3) return;
    setBusy(true); setError('');
    try {
      await onConfirm(booking, reason.trim());
      onClose();
    } catch (failure) {
      setError(failure.message?.includes('STAFF_CANCELLATION_NOT_ALLOWED') ? 'staffDenied' : 'staffError');
    } finally { setBusy(false); }
  }
  return <Modal isOpen onClose={close} title={t('bookings.cancelBooking')}>
    <form className="staff-cancel-form" onSubmit={submit}>
      <p>{t('bookings.cancelConfirmMessage', { name: booking.customerName })}</p>
      <p>{tr('staffNotice')}</p>
      <label>{tr('reason')}<textarea className="form-input" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} required minLength={3} maxLength={300} rows={3} /></label>
      {error && <p role="alert">{tr(error)}</p>}
      <div className="confirm-actions">
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={close}>{t('common.cancel')}</button>
        <button className="btn btn-danger" type="submit" disabled={busy || reason.trim().length < 3}>{t('bookings.cancelBooking')}</button>
      </div>
    </form>
  </Modal>;
}
