import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bookingSessionOwner, readBookingReceipt, readOnlineBookingReceipt, saveBookingReceipt, saveOnlineBookingReceipt } from '../../utils/customerBookingDraft';
import { customerBookingService } from '../../services/customerBooking.service';

const PAYMENT_STORAGE = 'barber-test-online-booking-payment';
export function savePendingPayment(capability) {
  sessionStorage.setItem(PAYMENT_STORAGE, JSON.stringify({ capability, owner: bookingSessionOwner() }));
}
export function pendingPaymentKey() {
  try {
    const item = JSON.parse(sessionStorage.getItem(PAYMENT_STORAGE));
    return item?.owner === bookingSessionOwner() && /^[a-f0-9-]{36}$/i.test(item?.capability) ? item.capability : null;
  }
  catch { return null; }
}
export function clearPendingPayment() {
  try { sessionStorage.removeItem(PAYMENT_STORAGE); }
  catch { /* Tab storage is optional once the receipt has loaded. */ }
}
export function onlinePaymentLink(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://sandbox.upayments.com' && !url.username && !url.password
        && /^[A-Za-z0-9_-]{10,90}$/.test(url.searchParams.get('session_id') || '')) return url.href;
  } catch { /* An invalid link stays on the status screen. */ }
  return '';
}

export function BookingPaymentReturn({ checkout: Checkout }) {
  const { t } = useTranslation();
  const [capability] = useState(pendingPaymentKey);
  const [attempt, setAttempt] = useState(null);
  const [receipt, setReceipt] = useState(() => {
    const saved = !capability && (readOnlineBookingReceipt() || readBookingReceipt());
    return saved?.paidOnline ? saved : null;
  });
  const [busy, setBusy] = useState(Boolean(capability));
  const [unavailable, setUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const tr = key => t('customerBooking.onlinePayment.' + key);

  useEffect(() => {
    if (!capability) return undefined;
    let active = true;
    customerBookingService.checkOnlinePayment(capability).then(result => {
      if (!active) return;
      setAttempt(result.attempt);
      if (result.receipt) {
        saveBookingReceipt(result.receipt);
        if (saveOnlineBookingReceipt(result.receipt)) clearPendingPayment();
        setReceipt(result.receipt);
      }
    }).catch(() => { if (active) setUnavailable(true); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [capability, refresh]);

  if (receipt) return <Checkout paidReceipt={receipt} />;

  const state = attempt?.state;
  const link = state === 'pending' && onlinePaymentLink(attempt.checkoutUrl);
  const settled = !busy && !unavailable && !['creating','pending'].includes(state);
  const refundMessage = { pending: 'refundPending', refunded: 'refunded', review: 'refundNeedsReview' }[attempt?.refundState];
  const message = busy ? 'checking' : unavailable ? 'statusUnavailable' : ({
    pending: attempt?.retryableFailure ? 'retryableFailure' : 'pending', creating: 'preparing', failed: 'failed', expired: 'expired', review: refundMessage || 'refundReview',
  })[state] || 'missing';

  return <div className="customer-booking">
    <div className="cb-layout">
      <main className="cb-main" id="booking-content">
        <h1>{tr('statusTitle')}</h1>
        <div className="cb-account-choice">
          <p role="status">{tr(message)}</p>
          <div className="cb-account-choice-actions">
            {link && <a className="cb-primary" href={link}>{tr('resume')}</a>}
            {capability && (!settled || state === 'review') && <button className="cb-secondary" type="button" disabled={busy}
              onClick={() => { setUnavailable(false); setBusy(true); setRefresh(count => count + 1); }}>{tr('checkAgain')}</button>}
            {settled && <a className="cb-secondary" href="/book" onClick={clearPendingPayment}>{tr('back')}</a>}
          </div>
        </div>
      </main>
    </div>
  </div>;
}
