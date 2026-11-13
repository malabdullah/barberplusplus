import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, CheckCircle2 } from 'lucide-react';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import { customerSupabase } from '../lib/customerSupabase';
import { deletionRequest } from '../services/customerDeletion.service';
import { clearDeletedBrowserAccount, deletionReceipt, saveDeletionReceipt } from '../utils/customerDeletionReceipt';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import './CustomerDeleteAccount.css';

export default function CustomerDeleteAccount() {
  const { t, i18n } = useTranslation(); const tr = (key, values) => t(`customerDeletion.${key}`, values);
  const [preview, setPreview] = useState(null); const [operation, setOperation] = useState(deletionReceipt);
  const [state, setState] = useState('loading'); const [method, setMethod] = useState('email_code');
  const [code, setCode] = useState(''); const [password, setPassword] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(Date.now()); const alive = useRef(true); const owner = useRef(''); const generation = useRef(0);
  const operationRef = useRef(operation); operationRef.current = operation;
  usePublicNavigationBusy(busy);
  const fail = failure => { setPassword(''); setError(failure.message || 'UNAVAILABLE'); if (['CODE_EXPIRED', 'REAUTH_REQUIRED'].includes(failure.message)) { setState('awaiting_code'); setConfirmed(false); setCode(''); } };
  const update = value => { saveDeletionReceipt(value); operationRef.current = value; setOperation(value); return value; };
  const receive = (value, saved) => {
    setState(value.state);
    if (['cleanup_pending', 'complete'].includes(value.state)) {
      update({ ...saved, phase: 'cleanup', appleManualRevocation: value.appleManualRevocation === true || saved.appleManualRevocation === true }); setPassword(''); setCode(''); setPreview(null);
      if (clearDeletedBrowserAccount(saved.ownerId)) window.location.replace('/customer/delete-account');
    }
  };
  useEffect(() => {
    alive.current = true; let changed = false;
    const { data } = customerSupabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id || '';
      if (owner.current && owner.current !== next) { generation.current++; setPreview(null); setPassword(''); setCode(''); setState('switched'); }
      changed = true; owner.current = next;
    });
    const load = async () => {
      try {
        const { data: session } = await customerSupabase.auth.getSession(); if (!alive.current) return;
        if (!changed) owner.current = session.session?.user?.id || '';
        const saved = deletionReceipt();
        if (saved?.receipt && ['confirming', 'cleanup'].includes(saved.phase)) { const value = await deletionRequest('status', { id: saved.id, receipt: saved.receipt }); if (alive.current) receive(value, saved); if (['cleanup_pending', 'complete'].includes(value.state)) return; }
        if (saved?.ownerId && owner.current && saved.ownerId !== owner.current) { setState('switched'); return; }
        const value = await deletionRequest('preview'); if (!alive.current) return;
        setPreview(value); setMethod(value.methods?.[0] || 'email_code'); setState('preview');
      } catch (failure) { if (alive.current) { setState('preview'); fail(failure); } }
    };
    load(); const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { alive.current = false; generation.current++; data.subscription.unsubscribe(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (state !== 'cleanup_pending' || !operation?.receipt) return undefined;
    let active = true; let waiting = false;
    const poll = async () => {
      if (waiting || document.hidden) return; waiting = true;
      try { const value = await deletionRequest('status', { id: operation.id, receipt: operation.receipt }); if (active) receive(value, operation); }
      catch (failure) { if (active) fail(failure); } finally { waiting = false; }
    };
    const timer = setInterval(poll, 3000); return () => { active = false; clearInterval(timer); };
  }, [state, operation?.id, operation?.receipt]);
  const run = async action => {
    if (busy) return; const version = generation.current;
    setBusy(true); setError('');
    try { await action(() => alive.current && version === generation.current); }
    catch (failure) { if (alive.current && version === generation.current) fail(failure); }
    finally { if (alive.current) setBusy(false); }
  };
  const start = () => run(async current => {
    const saved = operationRef.current?.ownerId === owner.current ? operationRef.current : { id: crypto.randomUUID(), ownerId: owner.current };
    update({ ...saved, phase: 'starting' });
    const value = await deletionRequest('start', { id: saved.id, language: i18n.language.startsWith('ar') ? 'ar' : 'en' });
    if (!current()) return;
    update({ ...saved, receipt: value.receipt, phase: 'proof' }); setPreview(previous => ({ ...previous, ...value })); setState('awaiting_code'); setResendAt(Date.now() + 60000);
  });
  const verify = event => { event.preventDefault(); run(async current => {
    const value = await deletionRequest(method === 'password' ? 'password' : 'verify', { id: operation.id, receipt: operation.receipt, ...(method === 'password' ? { password } : { code }) });
    if (current()) { setState(value.state); setPassword(''); setCode(''); setConfirmed(false); }
  }); };
  const confirm = () => run(async current => {
    const saved = update({ ...operation, phase: 'confirming' });
    try {
      const value = await deletionRequest('confirm', { id: saved.id, receipt: saved.receipt, digest: preview.digest, confirmCancellation: true });
      if (!current()) return;
      if (value.state === 'review_required') { setPreview(previous => ({ ...previous, ...value })); setConfirmed(false); setState('verified'); setError('REVIEW_REQUIRED'); update({ ...saved, phase: 'proof' }); }
      else receive(value, saved);
    } catch (failure) {
      // A lost response never starts a fresh operation. Check the saved receipt.
      const status = await deletionRequest('status', { id: saved.id, receipt: saved.receipt }).catch(() => null);
      if (!current()) return;
      if (status && ['cleanup_pending', 'complete'].includes(status.state)) receive(status, saved);
      else { setState(status ? status.state : 'uncertain'); if (status) update({ ...saved, phase: 'proof' }); throw failure; }
    }
  });
  const resend = () => run(async current => { await deletionRequest('resend', { id: operation.id, receipt: operation.receipt, language: i18n.language.startsWith('ar') ? 'ar' : 'en' }); if (current()) { setState('awaiting_code'); setCode(''); setResendAt(Date.now() + 60000); } });
  const retry = () => run(async current => { const value = await deletionRequest('retry', { id: operation.id, receipt: operation.receipt }); if (current()) receive(value, operation); });
  return <CustomerAuthLayout title={tr(state === 'complete' ? 'completeTitle' : 'title')} backTo={['complete', 'cleanup_pending', 'uncertain'].includes(state) ? '/' : '/customer/account'} backLabel={t('common.back')}>
    {error && <p className="cb-alert" role="alert">{t(`customerDeletion.errors.${error}`, { defaultValue: tr('errors.UNAVAILABLE') })}</p>}
    {state === 'loading' ? <p role="status"><Loader2 className="cb-spinner" size={20} />{t('common.loading')}</p> : state === 'complete' ? <div className="ca-result"><CheckCircle2 size={34} aria-hidden="true" /><p role="status">{tr('complete')}</p>{operation?.appleManualRevocation && <p>{tr('appleHelp')} <a href="https://account.apple.com" target="_blank" rel="noopener noreferrer">{tr('appleSettings')}</a></p>}<Link className="cb-primary ca-submit" to="/">{tr('home')}</Link></div> : ['cleanup_pending', 'uncertain'].includes(state) ? <div role="status"><p>{tr(state === 'uncertain' ? 'uncertain' : 'pending')}</p><button className="cb-secondary ca-submit" disabled={busy} onClick={retry}>{tr('checkStatus')}</button></div> : state === 'switched' ? <p role="status">{tr('switched')}</p> : preview && <>
      <p>{tr('effect')}</p>
      {preview.providers?.length > 0 && <p>{tr('providers', { providers: preview.providers.map(provider => ({ apple: 'Apple', google: 'Google', email: t('customerAuth.email.label'), phone: 'SMS' })[provider] || provider).join(' · ') })}</p>}
      <p>{tr('future', { count: preview.upcomingCount || 0 })}</p>
      {preview.upcoming?.length > 0 && <ul className="ca-deletion-bookings">{preview.upcoming.map(booking => <li key={booking.id}><strong>{i18n.dir() === 'rtl' && booking.shopAr || booking.shop}</strong><span>{i18n.dir() === 'rtl' && booking.barberAr || booking.barber}</span><bdi>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(`${booking.date}T${booking.time}+03:00`))}</bdi></li>)}</ul>}
      {preview.hasMore && <p>{tr('moreAppointments')}</p>}
      <p>{tr('history')}</p>
      {state === 'preview' ? <button className="cb-secondary ca-submit ca-delete-action" disabled={busy || !preview.methods?.length} onClick={start}><Trash2 size={18} aria-hidden="true" />{tr('continue')}</button> : state === 'awaiting_code' ? <form onSubmit={verify}>
        {preview.methods?.length > 1 && <label className="ca-field">{tr('method')}<select className="cb-input" value={method} onChange={event => { setMethod(event.target.value); setPassword(''); setCode(''); }}>{preview.methods.map(item => <option key={item} value={item}>{tr(item)}</option>)}</select></label>}
        {method === 'password' ? <label className="ca-field">{tr('password')}<input className="cb-input" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label> : <><p>{tr('codeSent', { destination: preview.destination })}</p><label className="ca-field">{tr('code')}<input className="cb-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label><button className="cb-text-button" type="button" disabled={busy || clock < resendAt} onClick={resend}>{tr('resend')}{clock < resendAt ? ` (${Math.ceil((resendAt - clock) / 1000)})` : ''}</button></>}
        <button className="cb-primary ca-submit" disabled={busy}>{tr('verify')}</button>
      </form> : state === 'verified' ? <><label className="ca-deletion-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />{tr('confirm')}</label><button className="cb-secondary ca-submit ca-delete-action" disabled={busy || !confirmed} onClick={confirm}><Trash2 size={18} aria-hidden="true" />{tr('delete')}</button></> : null}
    </>}
    {error === 'AUTH_REQUIRED' && <Link className="cb-primary ca-submit" to="/customer/sign-in">{t('customerAuth.signIn')}</Link>}
    <Link className="cb-text-button" to="/support?audience=customer">{t('settings.contactSupport')}</Link>
  </CustomerAuthLayout>;
}
