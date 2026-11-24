import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, MoreHorizontal, RotateCcw } from 'lucide-react';
import { walletBooking } from '../../services/bWallet.service';
import { customerAuthService } from '../../services/customerAuth.service';
import { downloadBookingCalendar, getKuwaitDate, safeBookingUrl } from '../../utils/customerBooking';
import { appointmentDate } from '../../utils/customerRebooking';
import BookingShareControls from './BookingShareControls';
import { shopWording } from '../../utils/customerTerminology';

const actionErrors = ['PACKAGE_DATE_UNAVAILABLE', 'BOOKING_NOT_MANAGEABLE', 'BOOKING_CUTOFF_PASSED', 'BOOKING_CHANGED', 'INVALID_DATE', 'INVALID_SELECTION', 'SLOT_UNAVAILABLE', 'AUTH_REQUIRED'];

export default function UpcomingBookingActions({ booking, onChange, onRefresh, walletEnabled = false }) {
  const { t, i18n } = useTranslation();
  const tr = (key, values) => t(`customerAuth.appointmentActions.${key}`, values);
  const locale = i18n.resolvedLanguage;
  const arabic = locale?.startsWith('ar');
  const [payment, setPayment] = useState(null);
  const [destination, setDestination] = useState('gateway');
  const [action, setAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const bookedTime = booking.time.slice(0, 5);
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState('');
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const dialog = useRef(null);
  const submitting = useRef(false);
  const id = useId();
  const directions = safeBookingUrl(booking.location_url);
  const shop = shopWording((arabic && booking.shop_name_ar) || booking.shop_name);
  const barber = (arabic && booking.barber_name_ar) || booking.barber_name;
  const services = (booking.services || []).map(item => ({ name: (arabic && item.name_ar) || item.name }));
  const formatDate = value => new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' }).format(value);
  const appointment = tr('summary', { shop, barber, date: formatDate(appointmentDate(booking)) });
  const cutoff = booking.cancellation_cutoff && new Date(booking.cancellation_cutoff);
  const rescheduleCutoff = new Date(booking.reschedule_cutoff || booking.cancellation_cutoff);
  const canCancel = cutoff && cutoff.getTime() > Date.now();
  const canMove = cutoff && rescheduleCutoff.getTime() > Date.now();
  const errorCopy = failure => actionErrors.includes(failure.message) ? failure.message : 'UNAVAILABLE';

  useEffect(() => {
    const node = dialog.current;
    if (action && !node.open) node.showModal();
    if (!action && node.open) node.close();
  }, [action]);

  useEffect(() => {
    if (action !== 'reschedule' || !date) return undefined;
    let active = true;
    setLoading(true);
    customerAuthService.appointmentSlots(booking.id, date).then(result => {
      if (active) setAvailability(result);
    }).catch(failure => {
      if (active) setError(errorCopy(failure));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [action, booking.id, date, reload]);

  useEffect(() => {
    if (!walletEnabled) return;
    let active = true;
    walletBooking('view',booking.id).then(detail => { if (active) setPayment(detail); }).catch(() => {});
    return () => { active = false; };
  }, [walletEnabled,booking.id,booking.status]);


  function open(next) {
    setError(''); setMessage(''); setDate(booking.date); setTime(bookedTime); setAvailability(null);
    setLoading(next === 'reschedule');
    setDestination(payment?.refundToWallet ? 'wallet' : 'gateway');
    setAction(next);
  }

  function changeDate(event) {
    const nextDate = event.target.value;
    setDate(nextDate); setTime(nextDate === booking.date ? bookedTime : ''); setError(''); setAvailability(null);
    setLoading(Boolean(nextDate));
  }

  const currentDate = date === booking.date;
  const alternatives = (availability?.slots || []).filter(slot => !currentDate || slot !== bookedTime);
  const slots = currentDate ? [...alternatives, bookedTime].sort() : alternatives;
  const canReschedule = !loading && alternatives.includes(time);

  async function save(event) {
    event.preventDefault();
    if (submitting.current || (action === 'reschedule' && !canReschedule)) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const changed = action === 'cancel'
        ? payment?.refundToWallet || payment?.refundChoice
          ? await customerAuthService.cancelWalletBooking(booking,destination)
          : await customerAuthService.cancelBooking(booking)
        : await customerAuthService.rescheduleBooking(booking, date, time);
      onChange(changed, action === 'cancel' ? tr('cancelled') : tr('rescheduled'));
      setAction('');
    } catch (failure) {
      setError(errorCopy(failure));
      if (failure.message === 'SLOT_UNAVAILABLE') {
        setTime(''); setAvailability(null); setLoading(true); setReload(value => value + 1);
      }
    } finally { submitting.current = false; setBusy(false); }
  }

  const calendar = () => downloadBookingCalendar({
    id: booking.id, reference: booking.id, date: booking.date, time: booking.time.slice(0, 5),
    duration: booking.duration, services, package: booking.package, branchName: shop, address: booking.shop_address, description: appointment,
  });
  const unavailable = ['BOOKING_NOT_MANAGEABLE', 'BOOKING_CUTOFF_PASSED', 'BOOKING_CHANGED'].includes(error);

  const waiting = payment?.state === 'pending_approval' || payment?.state === 'awaiting_payment';
  const canPay = payment?.state === 'awaiting_payment' && Date.parse(payment.payBy)>Date.now();
  return <div className="ca-upcoming-actions">
    {waiting && <p role="status">{payment.state === 'pending_approval' ? t('bWallet.pendingApproval')
      : canPay ? t('bWallet.payBy',{date:formatDate(new Date(payment.payBy))}) : t('bWallet.holdExpired')}</p>}
    {canPay && <Link className="cb-primary" to={`/customer/wallet/pay?booking=${booking.id}`}>{t('bWallet.payNow')}</Link>}
    {directions && <a className="cb-secondary" href={directions} target="_blank" rel="noreferrer">{tr('directions')}</a>}
    {canMove && !waiting && <button className="cb-secondary" type="button" onClick={() => open('reschedule')}><RotateCcw size={17} aria-hidden="true" />{tr('reschedule')}</button>}
    <details className="ca-upcoming-more">
      <summary className="cb-secondary"><MoreHorizontal size={18} aria-hidden="true" />{tr('more')}</summary>
      <div className="ca-upcoming-menu">
        {booking.duration > 0 && !waiting && <button type="button" onClick={calendar}><CalendarPlus size={17} aria-hidden="true" />{t('customerBooking.addCalendar')}</button>}
        {!waiting && <BookingShareControls bookingId={booking.id} menuItem />}
        {canCancel && <button type="button" className="ca-upcoming-danger" onClick={() => open('cancel')}>{tr('cancel')}</button>}
      </div>
    </details>
    {cutoff && <div className="ca-appointment-policy">
      <p>{canCancel ? t('bookingPolicy.cancelBy', { date: formatDate(cutoff) }) : t('bookingPolicy.cancelClosed')}</p>
      <p>{canMove ? t('bookingPolicy.rescheduleBy', { date: formatDate(rescheduleCutoff) }) : t('bookingPolicy.rescheduleClosed')}</p>
      {(!canCancel || !canMove) && <p>{t('bookingPolicy.contactShop')}</p>}
    </div>}
    {message && <p role="status">{message}</p>}
    <dialog ref={dialog} className="ca-appointment-dialog" aria-labelledby={id} onCancel={event => {
      event.preventDefault();
      if (!busy) setAction('');
    }}>
      {action && <form onSubmit={save}>
        <div className="ca-appointment-dialog-body">
          <h3 id={id}>{tr(action === 'cancel' ? 'cancelTitle' : 'reschedule')}</h3>
          <p>{appointment}</p>
          {action === 'cancel' && <p>{tr('cutoff', { date: formatDate(cutoff) })}</p>}
          {action === 'cancel' && payment?.refundToWallet && <p>{t('bWallet.refundWallet')}</p>}
          {action === 'cancel' && payment?.refundChoice && <fieldset className="cb-payment-method" disabled={busy}>
            <legend>{t('bWallet.refundDestination')}</legend>
            <label><input type="radio" name="refund-destination" checked={destination==='gateway'} onChange={() => setDestination('gateway')} />{t('bWallet.refundGateway')}</label>
            <label><input type="radio" name="refund-destination" checked={destination==='wallet'} onChange={() => setDestination('wallet')} />{t('bWallet.walletOnly')}</label>
            <p>{destination==='gateway' ? t('bWallet.gatewayRefundTiming') : t('bWallet.refundWallet')}</p>
          </fieldset>}
          {action === 'reschedule' && <>
            {!!services.length && <p>{services.map(service => service.name).join(arabic ? '، ' : ', ')}</p>}
            <p>{tr('rescheduleInfo')}</p>
            <label className="cb-field-label" htmlFor={`${id}-date`}>{tr('newDate')}</label>
            <input className="cb-input ca-appointment-date-input" id={`${id}-date`} type="date" value={date} min={getKuwaitDate()} max={[availability?.last_date, booking.package?.ends_on].filter(Boolean).sort()[0]} onChange={changeDate} disabled={busy || unavailable} required />
            {loading && <p role="status">{t('customerAuth.loading')}</p>}
            {!!slots.length && <fieldset className="cb-time-options" disabled={busy}>
              <legend className="cb-field-label">{tr('newTime')}</legend>
              {slots.map(slot => {
                const isCurrent = currentDate && slot === bookedTime;
                const className = [time === slot ? 'selected' : '', isCurrent ? 'ca-current-time' : ''].filter(Boolean).join(' ');
                return <label className={className} key={slot}>
                  <input type="radio" name="new-time" checked={time === slot} onChange={() => setTime(slot)} />
                  <span>{new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kuwait', timeStyle: 'short' }).format(appointmentDate({ date, time: slot }))}</span>
                  {isCurrent && <small>{tr('currentTime')}</small>}
                </label>;
              })}
            </fieldset>}
            {!loading && availability && !alternatives.length && <p>{tr('noTimes')}</p>}
          </>}
          {error && <p className="cb-alert" role="alert">{error === 'PACKAGE_DATE_UNAVAILABLE' ? t('packages.errors.PACKAGE_DATE_UNAVAILABLE') : tr(`errors.${error}`)}</p>}
        </div>
        <div className="ca-appointment-dialog-actions">
          <button className="cb-secondary" type="button" disabled={busy} onClick={() => setAction('')}>{tr(action === 'cancel' ? 'keep' : 'close')}</button>
          {unavailable ? <button className="cb-secondary" type="button" onClick={onRefresh}>{tr('refresh')}</button>
            : <button type="submit" className={action === 'cancel' ? 'cb-secondary ca-upcoming-danger' : 'cb-primary'} disabled={busy || (action === 'reschedule' && !canReschedule)}>
              {tr(action === 'cancel' ? 'cancel' : 'saveTime')}
            </button>}
        </div>
      </form>}
    </dialog>
  </div>;
}
