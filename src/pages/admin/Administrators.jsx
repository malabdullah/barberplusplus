import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { administratorsService } from '../../services/administrators.service';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import './AdminPages.css';

const errorCodes = ['SUPER_ADMIN_REQUIRED', 'VERIFIED_ACCOUNT_REQUIRED', 'ALREADY_ADMIN', 'SEPARATE_ADMIN_ACCOUNT_REQUIRED', 'PROTECTED_ADMIN_ACCOUNT', 'INVALID_DETAILS'];
export default function Administrators() {
  const { t } = useTranslation();
  const tr = (key, values) => t(`administrators.${key}`, values);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [users, setUsers] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inFlight = useRef(false);
  const errorText = failure => tr(`errors.${errorCodes.find(code => failure.message.includes(code)) || 'UNAVAILABLE'}`);
  useEffect(() => {
    let active = true;
    setLoading(true);
    administratorsService.list(page).then(result => {
      if (active) { setUsers(result.users); setHasMore(result.hasMore); }
    }).catch(failure => { if (active) setError(errorText(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);
  const confirm = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setSuccess('');
    try {
      if (pending.action === 'add') await administratorsService.add(pending.email);
      else await administratorsService.setEnabled(pending.user.id, !pending.user.enabled);
      setSuccess(tr(pending.action === 'add' ? 'added' : 'updated'));
      setEmail(''); setRevision(value => value + 1);
    } catch (failure) { setError(errorText(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="admin-page">
    <div className="admin-page-header"><Link className="admin-back-link" to="/admin/users">{t('admin.users.title')}</Link><h1>{tr('title')}</h1></div>
    <form className="password-reset-form" onSubmit={event => { event.preventDefault(); if (!busy) setPending({ action: 'add', email: email.trim().toLowerCase() }); }}>
      <label htmlFor="administrator-email">{tr('email')}</label>
      <input id="administrator-email" className="form-input" type="email" dir="ltr" autoComplete="off" maxLength={254} required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} />
      <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>{tr('add')}</button>
    </form>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    {loading ? <p role="status">{t('common.loading')}</p> : <div className="admin-table-container"><table className="admin-table">
      <thead><tr><th>{t('common.name')}</th><th>{tr('email')}</th><th>{tr('role')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead>
      <tbody>{users.map(person => <tr key={person.id}><td>{person.name || '—'}</td><td><bdi>{person.email}</bdi></td><td>{t(person.role === 'super_admin' ? 'common.superAdmin' : 'common.admin')}</td><td>{t(person.enabled ? 'common.active' : 'common.inactive')}</td><td>{person.role === 'super_admin' ? '—' : <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPending({ action: 'status', user: person })}>{tr(person.enabled ? 'suspend' : 'restore')}</button>}</td></tr>)}</tbody>
    </table></div>}
    <div className="password-reset-pagination"><button className="btn btn-secondary" type="button" disabled={page === 1 || loading || busy} onClick={() => setPage(value => value - 1)}>{t('admin.passwordReset.previous')}</button><span>{t('admin.passwordReset.page', { page })}</span><button className="btn btn-secondary" type="button" disabled={!hasMore || loading || busy} onClick={() => setPage(value => value + 1)}>{t('admin.passwordReset.next')}</button></div>
    <ConfirmDialog isOpen={Boolean(pending)} onClose={() => setPending(null)} onConfirm={confirm} variant="warning"
      title={tr(pending?.action === 'add' ? 'add' : pending?.user?.enabled ? 'suspend' : 'restore')}
      message={tr(pending?.action === 'add' ? 'confirmAdd' : 'confirmStatus', { email: pending?.email || pending?.user?.email })}
      confirmText={t('common.confirm')} cancelText={t('common.cancel')} />
  </div>;
}
