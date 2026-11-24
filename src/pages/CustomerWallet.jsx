import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { walletAmountFils, walletRpc, walletTopup } from '../services/bWallet.service';
import { reportMoney } from '../utils/reportFormatting';
import { onlinePaymentLink } from '../components/Customer/BookingPaymentReturn';
import './CustomerBooking.css';
import './CustomerAccount.css';
import './Wallet.css';

function Wallet({ owner }) {
  const { t, i18n } = useTranslation();
  const tr = (key, data) => t(`bWallet.${key}`, data);
  const money = fils => reportMoney(String(fils), i18n.language);
  const date = value => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(value));
  const location = useLocation();
  const storageKey = `barber-test-wallet-topup:${owner}`;
  const [summary, setSummary] = useState(null);
  const [topup, setTopup] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const request = useRef(null);
  const running = useRef(false);
  useEffect(() => {
    let live = true;
    const id = (() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } })();
    async function load() {
      try {
        const status = await walletRpc('status');
        if (!live) return;
        if (!status.enabled) { setSummary({ disabled: true }); return; }
        const attempt = await (id ? walletTopup('check', { id }) : walletTopup('latest')).catch(() => null);
        const data = await walletRpc('summary');
        if (live) { setSummary(data); setTopup(attempt); }
      } catch { if (live) setError('WALLET_UNAVAILABLE'); }
    }
    load();
    return () => { live = false; };
  }, [storageKey, refresh, location.search]);
  async function start(event) {
    event.preventDefault();
    if (running.current) return;
    const amountFils = walletAmountFils(amount);
    if (amountFils < 1000 || amountFils > 100000) { setError('WALLET_INVALID_TOPUP'); return; }
    running.current = true; setBusy(true); setError('');
    try {
      if (request.current?.amountFils !== amountFils) request.current = { amountFils, id: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, request.current.id);
      const result = await walletTopup('start', { ...request.current, language: i18n.language });
      sessionStorage.setItem(storageKey, result.id);
      setTopup(result);
      const link = onlinePaymentLink(result.checkoutUrl);
      if (link) window.location.assign(link);
      if (result.state === 'failed') request.current = null;
    } catch (failure) { setError(failure.message); }
    finally { running.current = false; setBusy(false); }
  }
  async function more() {
    if (running.current) return;
    running.current = true; setBusy(true);
    try {
      const page = await walletRpc('summary', { before: summary.nextBefore });
      setSummary({ ...page, transactions: [...summary.transactions, ...page.transactions] });
    } catch { setError('WALLET_UNAVAILABLE'); }
    finally { running.current = false; setBusy(false); }
  }
  if (summary?.disabled) return <Navigate to="/customer/account" replace />;
  const link = onlinePaymentLink(topup?.checkoutUrl);
  const pending = ['pending', 'creating', 'review'].includes(topup?.state);
  return <div className="customer-booking ca-page"><main className="ca-main wallet-page">
    <Link className="cb-text-button" to="/customer/account">{tr('back')}</Link>
    <h1>{tr('title')}</h1>
    {error && <p className="cb-alert" role="alert">{tr(`errors.${error}`, { defaultValue: tr('errors.WALLET_UNAVAILABLE') })}</p>}
    {summary ? <>
      <section className="ca-profile-panel wallet-panel">
        <p>{tr('available')}</p><p className="wallet-balance"><bdi>{money(summary.balanceFils)}</bdi></p>
        {summary.heldFils !== '0' && <p>{tr('held', { amount: money(summary.heldFils) })}</p>}
        {summary.nextExpiry && <p>{tr('expires', { amount: money(summary.nextExpiry.amountFils), date: date(summary.nextExpiry.at) })}</p>}
      </section>
      {topup && <section className="ca-profile-panel wallet-panel">
        <p role="status">{tr(`topupState.${topup.state}`, { amount: money(topup.amountFils) })}</p>
        {pending && <div className="ca-profile-buttons">
          {link && <a className="cb-primary" href={link}>{tr('resume')}</a>}
          <button className="cb-secondary" type="button" onClick={() => setRefresh(count => count + 1)}>{tr('check')}</button>
        </div>}
      </section>}
      {summary.acceptPayments && !pending && <section className="ca-profile-panel wallet-panel">
        <h2>{tr('topup')}</h2>
        <form className="wallet-form" onSubmit={start}>
          <div><label className="cb-field-label" htmlFor="wallet-amount">{tr('amount')}</label>
            <input id="wallet-amount" className="cb-input" inputMode="decimal" maxLength={10} value={amount}
              onChange={event => setAmount(event.target.value)} required /></div>
          <button className="cb-primary" disabled={busy} type="submit">{tr('continue')}</button>
        </form>
        <p className="cb-helper">{tr('newExpiry', { count: summary.expiryMonths })}</p>
      </section>}
      <section className="ca-profile-panel wallet-panel"><h2>{tr('history')}</h2>
        {summary.transactions.length ? <ul className="wallet-transactions">{summary.transactions.map(row =>
          <li key={row.id}><div>{tr(`kind.${row.kind}`)}<time dateTime={row.at}>{date(row.at)}</time></div><bdi>{money(row.amountFils)}</bdi></li>
        )}</ul> : <p>{tr('empty')}</p>}
        {summary.nextBefore && <button className="cb-secondary" type="button" disabled={busy} onClick={more}>{tr('more')}</button>}
      </section>
    </> : !error && <p role="status">{tr('loading')}</p>}
  </main></div>;
}

export default function CustomerWallet() {
  const { customer, loading } = useCustomerAuth();
  if (loading) return null;
  return customer ? <Wallet key={customer.id} owner={customer.id} /> : <Navigate to="/customer/sign-in" replace />;
}
