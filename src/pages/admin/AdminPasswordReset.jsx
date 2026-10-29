import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { validatePassword } from '../../utils/validation';
import './AdminPages.css';

export default function AdminPasswordReset() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setUserId('');
    supabase.functions.invoke('admin-password-reset', { body: { action: 'list', page } })
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure || !data || !Array.isArray(data.users)) { setError('admin.passwordReset.loadError'); return; }
        setUsers(data.users); setHasMore(data.hasMore === true);
      })
      .catch(() => { if (active) setError('admin.passwordReset.loadError'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page]);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!userId || !validatePassword(password).valid || new TextEncoder().encode(password).length > 72 || password !== confirm) {
      setError('admin.passwordReset.invalid'); return;
    }
    setBusy(true);
    try {
      const { data, error: failure } = await supabase.functions.invoke('admin-password-reset', {body:{action:'reset',userId,password}});
      if (failure || data?.success !== true) throw new Error('Reset failed');
      setPassword(''); setConfirm(''); setMessage(t(data.auditComplete === false ? 'admin.passwordReset.auditWarning' : 'admin.passwordReset.success'));
    } catch { setError('admin.passwordReset.failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Link to="/admin/users" className="admin-back-link">{t('admin.users.title')}</Link>
        <h1>{t('admin.passwordReset.title')}</h1>
        <p>{t('admin.passwordReset.description')}</p>
      </div>
      <form onSubmit={submit} className="password-reset-form">
        <label htmlFor="reset-user">{t('admin.passwordReset.account')}</label>
        <select id="reset-user" className="form-input" value={userId} onChange={event => setUserId(event.target.value)} disabled={loading || busy} required>
          <option value="">{loading ? t('common.loading') : t('admin.passwordReset.select')}</option>
          {users.map(user => <option key={user.id} value={user.id}>{user.email} ({t(user.role === 'customer' ? 'bookings.customer' : `common.${user.role}`)})</option>)}
        </select>
        <div className="password-reset-pagination">
          <button type="button" className="btn btn-secondary" disabled={page === 1 || loading || busy} onClick={() => setPage(value => value - 1)}>{t('admin.passwordReset.previous')}</button>
          <span>{t('admin.passwordReset.page', {page})}</span>
          <button type="button" className="btn btn-secondary" disabled={!hasMore || loading || busy} onClick={() => setPage(value => value + 1)}>{t('admin.passwordReset.next')}</button>
        </div>
        <label htmlFor="reset-password">{t('admin.passwordReset.password')}</label>
        <input id="reset-password" className="form-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required />
        <label htmlFor="reset-confirm">{t('admin.passwordReset.confirm')}</label>
        <input id="reset-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={busy} required />
        <p>{t('admin.passwordReset.guidance')}</p>
        {error && <p role="alert" className="password-reset-error">{t(error)}</p>}
        {message && <p role="status">{message}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || loading || !userId}>{busy ? t('common.saving') : t('admin.passwordReset.submit')}</button>
      </form>
    </div>
  );
}
