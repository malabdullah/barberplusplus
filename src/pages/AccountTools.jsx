import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { supabase } from '../lib/supabase';
import { customerSupabase } from '../lib/customerSupabase';
import './AccountTools.css';

function DeviceName({ agent, t }) {
  const system = /\biPhone\b/i.test(agent) ? 'iPhone' : /\biPad\b/i.test(agent) ? 'iPad'
    : /Android/i.test(agent) ? 'Android' : /Windows/i.test(agent) ? 'Windows'
    : /Macintosh/i.test(agent) ? 'Mac' : null;
  const browser = /Edg/i.test(agent) ? 'Edge' : /Firefox|FxiOS/i.test(agent) ? 'Firefox'
    : /Chrome|CriOS/i.test(agent) ? 'Chrome' : /Safari/i.test(agent) ? 'Safari' : null;
  return [system, browser].filter(Boolean).join(' · ') || t('accountTools.unknownDevice');
}

const staffPaths = { admin: '/admin', manager: '/dashboard', barber: '/barber', agent: '/agent' };

export default function AccountTools({ view, customer = false }) {
  const { t, i18n } = useTranslation();
  const { user, userRole } = useApp();
  const customerAuth = useCustomerAuth();
  const accountId = customer ? customerAuth.customer?.id : user?.id;
  const waitingForCustomer = customer && customerAuth.loading;
  const client = customer ? customerSupabase : supabase;
  const back = customer ? '/customer/account' : (staffPaths[userRole] || '/dashboard') + '/settings';
  const activity = view === 'activity';
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [revokeFailed, setRevokeFailed] = useState(false);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  useEffect(() => {
    setRows([]);
    setCursor(null);
    setTarget(null);
  }, [accountId, view]);

  useEffect(() => {
    if (!accountId) return undefined;
    let active = true;
    setLoading(true);
    setError(false);
    const load = async () => {
      const result = activity
        ? await client.rpc('account_activity', { p_before: cursor })
        : await client.rpc('account_sessions');
      if (!active) return;
      if (result.error) setError(true);
      else {
        setRows(current => cursor ? [...current, ...result.data] : result.data);
        setHasMore(activity && result.data.length === 25);
      }
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [accountId, activity, attempt, client, cursor]);

  useEffect(() => {
    if (target && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!target && dialog.current?.open) dialog.current.close();
  }, [target]);

  const revoke = async () => {
    if (!target || busy) return;
    setBusy(true);
    setRevokeFailed(false);
    try {
      const { data, error: failure } = await client.rpc('account_sessions', { p_revoke: target.id });
      if (failure) throw failure;
      setRows(data);
      setTarget(null);
    } catch { setRevokeFailed(true); }
    finally { setBusy(false); }
  };

  if (waitingForCustomer) return <p role="status">{t('common.loading')}</p>;
  if (customer && !accountId) return <Navigate to="/customer/sign-in" replace />;

  const title = t(activity ? 'accountTools.activity' : 'settings.activeSessions');
  return (
    <section className="account-tools">
      <Link to={back}>{t('common.back')}</Link>
      <h1>{title}</h1>
      <p>{t(activity ? 'accountTools.activityHint' : 'accountTools.sessionsHint')}</p>
      {loading && <p role="status">{t('common.loading')}</p>}
      {error && <p role="alert">{t('accountTools.loadFailed')} <button className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button></p>}
      {!error && !loading && !rows.length && <p>{t(activity ? 'accountTools.noActivity' : 'accountTools.noSessions')}</p>}
      <ul className="account-tools-list">
        {rows.map(row => (
          <li key={row.id}>
            <div>
              <strong>{activity ? t('accountTools.events.' + row.kind) : <DeviceName agent={row.device} t={t} />}</strong>
              {activity ? (
                <p>{[
                  (i18n.language.startsWith('ar') && row.shop_ar) || row.shop,
                  row.reference && '#' + row.reference,
                  row.by_you ? t('accountTools.you') : row.actor_name || t('accountTools.actors.' + (row.actor_role || 'unknown')),
                ].filter(Boolean).join(' · ')}</p>
              ) : (
                <p>{row.current ? t('accountTools.currentDevice') : t('accountTools.lastRefresh')}</p>
              )}
              <time dateTime={activity ? row.happened_at : row.last_active_at}>
                {date.format(new Date(activity ? row.happened_at : row.last_active_at))}
              </time>
            </div>
            {!activity && !row.current && <button type="button" className="btn btn-secondary" onClick={() => { setTarget(row); setRevokeFailed(false); }}>{t('accountTools.endSession')}</button>}
          </li>
        ))}
      </ul>
      {activity && hasMore && !loading && !error && <button className="btn btn-secondary" onClick={() => setCursor(rows.at(-1).id)}>{t('accountTools.loadMore')}</button>}
      <dialog ref={dialog} className="account-tools-dialog" aria-labelledby="end-session-title"
        onCancel={event => { event.preventDefault(); if (!busy) setTarget(null); }}>
        <h2 id="end-session-title">{t('accountTools.endSession')}</h2>
        <p role={revokeFailed ? 'alert' : undefined}>{t(revokeFailed ? 'accountTools.revokeFailed' : 'accountTools.endSessionPrompt')}</p>
        <div className="account-tools-dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setTarget(null)}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={revoke}>{t('accountTools.endSession')}</button>
        </div>
      </dialog>
    </section>
  );
}
