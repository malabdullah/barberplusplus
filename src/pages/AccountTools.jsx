import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowLeft, Laptop, Loader2, LogOut, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import useAccountAccess from '../hooks/useAccountAccess';
import AccountAccessState from '../components/AccountAccessState';
import { accountToolsService } from '../services/accountTools.service';
import './CustomerBooking.css';
import './AccountTools.css';
export const accountSettingsPath = role => ({ admin: '/admin/settings', manager: '/dashboard/settings', barber: '/barber/settings', agent: '/agent/settings' })[role] || '/customer/account';
export function deviceName(agent, t) {
  const system = /\biPhone\b/i.test(agent) ? 'iPhone' : /\biPad\b/i.test(agent) ? 'iPad' : /Android/i.test(agent) ? 'Android' : /Windows/i.test(agent) ? 'Windows' : /Macintosh|Mac OS/i.test(agent) ? 'Mac' : /Linux/i.test(agent) ? 'Linux' : '';
  const browser = /Edg/i.test(agent) ? 'Edge' : /Firefox|FxiOS/i.test(agent) ? 'Firefox' : /Chrome|CriOS/i.test(agent) ? 'Chrome' : /Safari/i.test(agent) ? 'Safari' : '';
  return [system, browser].filter(Boolean).join(' · ') || t('accountTools.unknownDevice');
}
export default function AccountTools({ view, customer = false }) {
  const { t, i18n } = useTranslation();
  const access = useAccountAccess();
  const [rows, setRows] = useState([]);
  const [current, setCurrent] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const generation = useRef(0);
  const activity = view === 'activity';
  const token = access.session?.access_token;
  useEffect(() => { generation.current++; setBusy(false); setRows([]); setCurrent(null); setCursor(null); setNextCursor(null); setTarget(null); setNotice(''); }, [token, activity, customer]);
  useEffect(() => {
    if (!access.identity || !token) return undefined;
    let active = true;
    setLoading(true); setError('');
    const call = activity ? accountToolsService.activity(customer ? 'customer' : 'work', cursor, token) : accountToolsService.sessions(cursor, token);
    call.then(result => {
      if (!active) return;
      setRows(previous => cursor ? [...previous, ...result.rows] : result.rows);
      setCurrent(result.currentSession || null); setNextCursor(result.nextCursor);
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [access.identity, token, activity, customer, cursor, attempt]);
  useEffect(() => {
    if (target && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!target && dialog.current?.open) dialog.current.close();
  }, [target]);
  const revoke = async () => {
    if (busy || !target) return;
    const request = generation.current; setBusy(true); setError('');
    try {
      await accountToolsService.revokeSession(target.id, token);
      if (request !== generation.current) return;
      setTarget(null); setNotice(t('accountTools.sessionEnded')); setRows(previous => previous.filter(row => row.id !== target.id));
    } catch (failure) { if (request === generation.current) setError(failure.message); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const date = value => new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar-KW' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(value));
  const title = t(activity ? 'accountTools.activity' : 'settings.activeSessions');
  const back = customer ? '/customer/account' : accountSettingsPath(access.identity?.role);
  const Icon = activity ? Activity : ShieldCheck;
  const Container = customer ? 'main' : 'section';
  const sessionRow = (row, pinned) => {
    const Mobile = /iPhone|iPad|Android/i.test(row.device) ? Smartphone : Laptop;
    return <li key={row.id} className={pinned ? 'account-session-current' : ''}>
      <span className="account-tools-icon"><Mobile size={22} aria-hidden="true" /></span>
      <div className="account-tools-copy"><strong>{deviceName(row.device, t)}</strong><p>{t(pinned ? 'accountTools.currentDevice' : 'accountTools.lastRefresh')}</p><time dateTime={row.lastActiveAt}>{date(row.lastActiveAt)}</time></div>
      {pinned ? <span className="account-tools-badge">{t('accountTools.thisDevice')}</span> : <button className="cb-secondary" type="button" disabled={busy} onClick={() => { setTarget(row); setError(''); }}><LogOut size={16} aria-hidden="true" />{t('accountTools.endSession')}</button>}
    </li>;
  };
  return <Container className="account-tools" dir={i18n.dir()}>
    {!access.identity ? <AccountAccessState access={access} /> : <>
      <Link className="account-tools-back" to={back}><ArrowLeft size={17} aria-hidden="true" />{t('common.back')}</Link>
      <header className="account-tools-heading"><div><Icon size={24} aria-hidden="true" /><h1>{title}</h1></div><button className="cb-secondary" type="button" disabled={loading || busy} onClick={() => { setCursor(null); setAttempt(n => n + 1); }}><RefreshCw size={16} aria-hidden="true" />{t('common.refresh')}</button></header>
      {notice && <p role="status" className="account-tools-notice">{notice}</p>}
      {error && <p role="alert">{t(error === 'SESSION_NOT_FOUND' ? 'accountTools.sessionUnavailable' : 'accountTools.loadFailed')} <button className="cb-secondary" type="button" onClick={() => setAttempt(n => n + 1)}>{t('common.retry')}</button></p>}
      {!activity && current && <ul className="account-tools-list">{sessionRow(current, true)}</ul>}
      {!loading && !error && !rows.length && <div className="account-tools-empty"><Icon size={30} aria-hidden="true" /><p>{t(activity ? 'accountTools.noActivity' : 'accountTools.noOtherSessions')}</p></div>}
      <ul className="account-tools-list">{rows.map(row => activity ? <li key={row.id}><span className="account-tools-icon"><Activity size={20} aria-hidden="true" /></span><div className="account-tools-copy"><strong>{t(`accountTools.events.${row.kind}`)}</strong><p>{[(i18n.language.startsWith('ar') && row.shopAr) || row.shop, row.reference && `#${row.reference}`, row.byYou ? t('accountTools.you') : row.actorName || t(`accountTools.actors.${row.actorRole || 'unknown'}`, { defaultValue: t('accountTools.actors.unknown') })].filter(Boolean).join(' · ')}</p><time dateTime={row.happenedAt}>{date(row.happenedAt)}</time></div></li> : sessionRow(row, false))}</ul>
      {loading && <p className="account-tools-status" role="status"><Loader2 className="cb-spinner" size={20} aria-hidden="true" />{t('common.loading')}</p>}
      {nextCursor && !loading && <button type="button" className="cb-secondary account-tools-more" onClick={() => setCursor(nextCursor)}>{t('accountTools.loadMore')}</button>}
      <dialog ref={dialog} className="account-tools-dialog" aria-labelledby="end-session-title" onCancel={event => { event.preventDefault(); if (!busy) setTarget(null); }}>
        <h2 id="end-session-title">{t('accountTools.endSession')}</h2>
        <p>{target && deviceName(target.device, t)}</p><p>{t('accountTools.endSessionPrompt')}</p>
        {error && <p role="alert">{t('accountTools.revokeFailed')}</p>}
        <div className="account-tools-dialog-actions"><button type="button" className="cb-secondary" disabled={busy} onClick={() => setTarget(null)}>{t('common.cancel')}</button><button type="button" className="btn btn-danger" disabled={busy} onClick={revoke}>{busy ? t('common.saving') : t('accountTools.endSession')}</button></div>
      </dialog>
    </>}
  </Container>;
}
