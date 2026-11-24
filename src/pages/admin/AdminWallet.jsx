import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { walletAmountFils, walletRpc } from '../../services/bWallet.service';
import { reportMoney } from '../../utils/reportFormatting';
import '../Wallet.css';

export default function AdminWallet() {
  const { t, i18n } = useTranslation();
  const tr = (key, data) => t(`bWallet.${key}`, data);
  const money = amount => reportMoney(String(amount), i18n.language);
  const [months, setMonths] = useState('');
  const [policyReason, setPolicyReason] = useState('');
  const [lookup, setLookup] = useState('');
  const [kind, setKind] = useState('customerId');
  const [rows, setRows] = useState(null);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requests = useRef(null);
  const writing = useRef(false);
  useEffect(() => {
    let active = true;
    walletRpc('admin-settings').then(data => { if (active) setMonths(String(data.expiryMonths)); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);

  async function send(action, payload, writes = false) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (writes) {
        const input = JSON.stringify([action,payload]);
        if (requests.current?.input !== input) requests.current = { input, id: crypto.randomUUID() };
        payload = { ...payload, requestId: requests.current.id };
      }
      const result = await walletRpc(action,payload);
      if (writes) requests.current = null;
      return result;
    } catch (failure) { setError(failure.message); }
    finally { writing.current = false; setBusy(false); }
  }
  async function savePolicy(event) {
    event.preventDefault();
    const result = await send('admin-set-expiry', { expiryMonths:Number(months), reason:policyReason.trim() }, true);
    if (result) { setMonths(String(result.expiryMonths)); setPolicyReason(''); setMessage('settingsSaved'); }
  }
  async function search(event) {
    event.preventDefault();
    setRows(null);
    const result = await send('admin-lookup', { [kind]:lookup.trim() });
    if (result) setRows(result.transactions);
  }
  function review(event) {
    event.preventDefault();
    const amountFils = walletAmountFils(amount);
    if (amountFils === null || amountFils <= 0 || amountFils > 1000000000) { setError('WALLET_INVALID_CREDIT'); return; }
    setPreview({ customerId:person.trim(), amountFils:String(amountFils), reason:reason.trim() });
  }
  async function credit() {
    const result = await send('admin-goodwill', preview, true);
    if (result) { setPreview(null); setAmount(''); setReason(''); setMessage('creditIssued'); }
  }

  return <main className="report-page">
    <header className="page-header"><h1>{tr('title')}</h1></header>
    {message && <p role="status">{tr(message)}</p>}
    {error && <p role="alert">{tr(`errors.${error}`, { defaultValue:tr('errors.WALLET_UNAVAILABLE') })}</p>}
    {months && <>
      <section className="card wallet-admin-panel"><h2>{tr('settings')}</h2>
        <form className="wallet-form" onSubmit={savePolicy}>
          <div><label className="form-label" htmlFor="wallet-months">{tr('months')}</label>
            <input className="form-input" id="wallet-months" type="number" value={months} min="1" max="60" onChange={event => setMonths(event.target.value)} required /></div>
          <div><label className="form-label" htmlFor="wallet-policy-reason">{tr('reason')}</label>
            <input className="form-input" id="wallet-policy-reason" value={policyReason} minLength={3} maxLength={240} onChange={event => setPolicyReason(event.target.value)} required /></div>
          <button className="btn btn-primary" type="submit" disabled={busy}>{t('common.save')}</button>
        </form>
      </section>
      <section className="card wallet-admin-panel"><h2>{tr('lookup')}</h2>
        <form className="wallet-form" onSubmit={search}>
          <div><label className="form-label" htmlFor="wallet-lookup-mode">{tr('searchBy')}</label><select className="form-input" id="wallet-lookup-mode" value={kind} onChange={event => { setKind(event.target.value); setRows(null); }}>
            <option value="customerId">{tr('customerId')}</option><option value="reference">{tr('reference')}</option>
          </select></div>
          <div><label className="form-label" htmlFor="wallet-lookup">{tr(kind)}</label><input className="form-input" id="wallet-lookup" value={lookup} onChange={event => setLookup(event.target.value)} dir="ltr" maxLength={36} required /></div>
          <button className="btn btn-primary" type="submit" disabled={busy}>{tr('lookup')}</button>
        </form>
        {rows && (rows.length ? <ul className="wallet-transactions">{rows.map(row => <li key={row.id}>
          <span>{tr(`kind.${row.kind}`)} <bdi>#{row.id}</bdi></span><bdi>{money(row.amountFils)}</bdi>
        </li>)}</ul> : <p>{tr('empty')}</p>)}
      </section>
      <section className="card wallet-admin-panel"><h2>{tr('goodwill')}</h2>
        {preview ? <>
          <p>{tr('creditPreview', { amount:money(preview.amountFils), customer:preview.customerId })}</p>
          <p>{preview.reason}</p>
          <button className="btn btn-primary" disabled={busy} type="button" onClick={credit}>{tr('issueCredit')}</button>{' '}
          <button className="btn btn-secondary" disabled={busy} type="button" onClick={() => setPreview(null)}>{t('common.cancel')}</button>
        </> : <form className="wallet-form" onSubmit={review}>
          <div><label className="form-label" htmlFor="wallet-customer">{tr('customerId')}</label><input className="form-input" id="wallet-customer" value={person} onChange={event => setPerson(event.target.value)} dir="ltr" maxLength={36} required /></div>
          <div><label className="form-label" htmlFor="wallet-goodwill-amount">{tr('amount')}</label><input className="form-input" id="wallet-goodwill-amount" value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" maxLength={10} required /></div>
          <div><label className="form-label" htmlFor="wallet-reason">{tr('reason')}</label><input className="form-input" id="wallet-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={240} required /></div>
          <button className="btn btn-primary" disabled={busy} type="submit">{tr('review')}</button>
        </form>}
      </section>
    </>}
  </main>;
}
