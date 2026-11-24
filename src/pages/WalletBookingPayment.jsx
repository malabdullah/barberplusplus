import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { walletAmountFils, walletBooking, walletRpc } from '../services/bWallet.service';
import { customerBookingService } from '../services/customerBooking.service';
import { onlinePaymentLink, savePendingPayment } from '../components/Customer/BookingPaymentReturn';
import { reportMoney } from '../utils/reportFormatting';
import './CustomerBooking.css';
import './CustomerAccount.css';
import './Wallet.css';

function PayApproved({ id }) {
  const { t, i18n } = useTranslation();
  const tr = (key, args) => t(`bWallet.${key}`,args);
  const money = amount => reportMoney(String(amount), i18n.language);
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [balance, setBalance] = useState(0);
  const [splitAmount, setSplitAmount] = useState('');
  const [tender, setTender] = useState('gateway');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const intent = useRef(null);

  useEffect(() => {
    let current = true;
    Promise.all([walletBooking('view',id),walletRpc('summary')]).then(([booking, summary]) => {
      if (current) { setDetail(booking || {}); setBalance(Number(summary.balanceFils)); }
    }).catch(() => { if (current) setError('WALLET_UNAVAILABLE'); });
    return () => { current = false; };
  },[id]);

  const total = Number(detail?.totalFils);
  const expired = detail && (detail.state !== 'awaiting_payment' || Date.parse(detail.payBy) <= Date.now());
  const chooseAll = balance >= total;
  const chooseSplit = balance>0 && total>1;
  const splitFils = walletAmountFils(splitAmount);
  const validSplit = splitFils>0 && splitFils<total && splitFils<=balance;

  async function pay(event) {
    event.preventDefault();
    if (running.current || expired || tender==='split' && !validSplit) return;
    running.current = true; setBusy(true); setError('');
    try {
      const amount = tender === 'wallet' && chooseAll ? total : tender === 'split' && chooseSplit ? splitFils : 0;
      if (intent.current?.amount !== amount) intent.current = { amount, key: crypto.randomUUID() };
      savePendingPayment(intent.current.key);
      const { attempt } = await customerBookingService.payApproved(id, amount, intent.current.key, i18n.language);
      const link = onlinePaymentLink(attempt?.checkoutUrl);
      if (link) { window.location.assign(link); return; }
      navigate('/book?payment=return', { replace:true });
    } catch (failure) {
      if (['UNAVAILABLE','UPAYMENTS_CHECK_UNAVAILABLE'].includes(failure.message) || failure.name === 'TimeoutError') {
        navigate('/book?payment=return', { replace:true }); return;
      }
      setError(failure.message);
    } finally { running.current = false; setBusy(false); }
  }

  return <div className="customer-booking ca-page"><main className="ca-main wallet-page">
    <Link to="/customer/account" className="cb-text-button">{tr('back')}</Link>
    <h1>{tr('payBooking')}</h1>
    {error && <p role="alert" className="cb-alert">{tr(`errors.${error}`, { defaultValue:tr('errors.WALLET_UNAVAILABLE') })}</p>}
    {expired ? <p role="status">{tr('holdExpired')}</p> : detail ? <section className="ca-profile-panel wallet-panel">
      <p>{tr('payBy', { date: new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuwait'}).format(new Date(detail.payBy)) })}</p>
      <p className="wallet-balance"><bdi>{money(total)}</bdi></p>
      <form onSubmit={pay}>
        <fieldset className="cb-payment-method" disabled={busy}>
          <legend>{t('customerBooking.onlinePayment.method')}</legend>
          <label><input type="radio" name="approved-tender" checked={tender==='gateway'} onChange={() => setTender('gateway')} />{t('customerBooking.onlinePayment.option')}</label>
          {chooseAll && <label><input type="radio" name="approved-tender" checked={tender==='wallet'} onChange={() => setTender('wallet')} />{tr('walletOnly')}</label>}
          {chooseSplit && <label><input type="radio" name="approved-tender" checked={tender==='split'} onChange={() => { setTender('split'); setSplitAmount((Math.min(balance,total-1)/1000).toFixed(3)); }} />{tr('splitChoice')}</label>}
        </fieldset>
        {chooseSplit && tender==='split' && <div className="wallet-panel">
          <label className="cb-field-label" htmlFor="approved-wallet-amount">{tr('walletAmount')}</label>
          <input className="cb-input" id="approved-wallet-amount" inputMode="decimal" maxLength={10} value={splitAmount} onChange={event => setSplitAmount(event.target.value)} />
          {validSplit && <p className="cb-helper">{tr('split',{wallet:money(splitFils),card:money(total-splitFils)})}</p>}
        </div>}
        <button className="cb-primary" type="submit" disabled={busy || tender==='split' && !validSplit}>{tr('payNow')}</button>
      </form>
    </section> : !error && <p role="status">{tr('loading')}</p>}
  </main></div>;
}

export default function WalletBookingPayment() {
  const { customer,loading } = useCustomerAuth();
  const location = useLocation();
  const booking = new URLSearchParams(location.search).get('booking') || '';
  if (loading) return null;
  if (!customer) return <Navigate to="/customer/sign-in" replace />;
  return /^[0-9a-f-]{36}$/i.test(booking) ? <PayApproved id={booking} key={customer.id+booking} /> : <Navigate to="/customer/account" replace />;
}
