import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { administratorsService as api } from '../../services/administrators.service';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import Modal from '../../components/UI/Modal';
import { validatePassword } from '../../utils/validation';
import './AdminPages.css';
const codes = ['SUPER_ADMIN_REQUIRED', 'PROTECTED_ADMIN_ACCOUNT', 'EMAIL_IN_USE', 'EMAIL_CHANGED_REFRESH', 'INVALID_DETAILS', 'INVITE_EXISTS', 'INVITE_INVALID', 'INVITE_PROCESSING', 'RATE_LIMITED', 'ADMIN_DELETION_PENDING', 'RESET_FAILED', 'INVALID_EMAIL', 'AUTH_REQUIRED', 'ADMIN_MFA_REQUIRED'];
export default function Administrators() {
  const { t } = useTranslation();
  const tr = (key, values) => t('administrators.' + key, values);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [users, setUsers] = useState([]), [hasMore, setHasMore] = useState(false);
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null), [editor, setEditor] = useState(null);
  const [password, setPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const errorText = failure => tr('errors.' + (codes.find(code => String(failure.message).includes(code)) || 'UNAVAILABLE'));
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.list(page).then(result => {
      if (active) { setUsers(result.users); setHasMore(result.hasMore); }
    }).catch(failure => { if (active) setError(errorText(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);
  const perform = async (action, person, data = {}) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let result;
      if (action === 'invite') { result = await api.invite(name.trim(), email.trim().toLowerCase()); setName(''); setEmail(''); }
      if (action === 'resend') result = await api.resend(person.id);
      if (action === 'cancel') await api.cancel(person.id);
      if (action === 'status') await api.setEnabled(person.id, !person.enabled);
      if (action === 'delete') await api.remove(person.id);
      if (action === 'edit') await api.edit({ userId: person.id, expectedEmail: person.email, ...data });
      if (action === 'password') await api.resetPassword(person.id, data.password);
      if (result?.delivered === false) setError(tr('errors.EMAIL_DELIVERY_FAILED'));
      else setNotice(tr(['invite', 'resend'].includes(action) ? 'sent' : action === 'delete' ? 'deleted' : action === 'password' ? 'passwordChanged' : 'updated'));
      setEditor(null); setPassword(''); setConfirmPassword(''); setRevision(value => value + 1);
    } catch (failure) {
      setError(errorText(failure));
      if (String(failure.message).includes('ADMIN_DELETION_PENDING')) setRevision(value => value + 1);
    } finally { inFlight.current = false; setBusy(false); }
  };
  const openEditor = (person, mode) => {
    setError(''); setNotice(''); setPassword(''); setConfirmPassword('');
    setEditor({ person, mode, name: person.name, email: person.email });
  };
  const submitEditor = event => {
    event.preventDefault();
    if (busy) return;
    if (editor.mode === 'password') {
      if (!validatePassword(password).valid || new TextEncoder().encode(password).length > 72 || password !== confirmPassword) { setError(tr('errors.WEAK_PASSWORD')); return; }
      void perform('password', editor.person, { password });
    } else void perform('edit', editor.person, { name: editor.name.trim(), email: editor.email.trim().toLowerCase() });
  };
  const actions = person => {
    if (person.role === 'super_admin') return '—';
    if (person.kind === 'invitation') return <div className="administrator-actions">
      <button type="button" className="btn btn-secondary" disabled={busy || person.status === 'processing'} onClick={() => void perform('resend', person)}>{tr('resend')}</button>
      <button type="button" className="btn btn-ghost" disabled={busy || person.status === 'processing'} onClick={() => setPending({ action: 'cancel', person })}>{t('common.cancel')}</button>
    </div>;
    if (person.status === 'deleting') return <button className="btn btn-danger" type="button" disabled={busy} onClick={() => setPending({ action: 'delete', person })}>{tr('retryDelete')}</button>;
    const menuAction = (event, action) => { event.currentTarget.closest('details').open = false; setPending({ action, person }); };
    return <div className="administrator-actions">
      <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => openEditor(person, 'edit')}>{t('common.edit')}</button>
      <details className="administrator-more" name="administrator-actions"><summary className="btn btn-secondary">{tr('more')}</summary><div>
        <button type="button" disabled={busy} onClick={event => { event.currentTarget.closest('details').open = false; openEditor(person, 'password'); }}>{tr('resetPassword')}</button>
        <button type="button" disabled={busy} onClick={event => menuAction(event, 'status')}>{tr(person.enabled ? 'suspend' : 'restore')}</button>
        <button type="button" className="administrator-delete" disabled={busy} onClick={event => menuAction(event, 'delete')}>{t('common.delete')}</button>
      </div></details>
    </div>;
  };
  return <div className="admin-page administrators-page">
    <div className="admin-page-header"><Link className="admin-back-link" to="/admin/users">{t('admin.users.title')}</Link><h1>{tr('title')}</h1></div>
    <form className="administrator-invite-form" onSubmit={event => { event.preventDefault(); void perform('invite'); }}>
      <div><label htmlFor="administrator-name">{t('common.fullName')}</label><input id="administrator-name" className="form-input" autoComplete="off" required minLength={2} maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></div>
      <div><label htmlFor="administrator-email">{t('customerAuth.email.label')}</label><input id="administrator-email" className="form-input" type="email" dir="ltr" autoComplete="off" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></div>
      <button className="btn btn-primary" type="submit" disabled={busy}>{tr(busy ? 'sending' : 'add')}</button>
    </form>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="administrator-notice" role="status">{notice}</p>}
    {loading ? <p role="status">{t('common.loading')}</p> : <div className="admin-table-container"><table className="admin-table">
      <thead><tr><th>{t('common.name')}</th><th>{t('customerAuth.email.label')}</th><th>{tr('role')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead>
      <tbody>{users.map(person => <tr key={person.id}><td>{person.name || '—'}</td><td><bdi>{person.email}</bdi></td><td>{t(person.role === 'super_admin' ? 'common.superAdmin' : 'common.admin')}</td><td><span className={'administrator-status ' + person.status}>{tr('statuses.' + person.status)}</span></td><td>{actions(person)}</td></tr>)}</tbody>
    </table></div>}
    <div className="password-reset-pagination">
      <button className="btn btn-secondary" type="button" disabled={page === 1 || loading || busy} onClick={() => setPage(v => v - 1)}>{t('admin.passwordReset.previous')}</button>
      <span>{t('admin.passwordReset.page', { page })}</span>
      <button className="btn btn-secondary" type="button" disabled={!hasMore || loading || busy} onClick={() => setPage(v => v + 1)}>{t('admin.passwordReset.next')}</button>
    </div>
    <Modal isOpen={Boolean(editor)} onClose={() => { if (!busy) { setEditor(null); setPassword(''); setConfirmPassword(''); } }} title={editor?.mode === 'password' ? tr('resetPassword') : tr('edit')}>
      {editor && <form className="administrator-editor" onSubmit={submitEditor}>
        <p><bdi>{editor.person.email}</bdi></p>
        {editor.mode === 'password' ? <>
          <label htmlFor="administrator-password">{t('admin.passwordReset.password')}</label><input id="administrator-password" className="form-input" type="password" autoComplete="new-password" required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
          <label htmlFor="administrator-password-confirm">{t('admin.passwordReset.confirm')}</label><input id="administrator-password-confirm" className="form-input" type="password" autoComplete="new-password" required disabled={busy} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
        </> : <>
          <label htmlFor="administrator-edit-name">{t('common.fullName')}</label><input id="administrator-edit-name" className="form-input" required minLength={2} maxLength={120} disabled={busy} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} />
          <label htmlFor="administrator-edit-email">{t('customerAuth.email.label')}</label><input id="administrator-edit-email" className="form-input" type="email" dir="ltr" required maxLength={254} disabled={busy} value={editor.email} onChange={event => setEditor({ ...editor, email: event.target.value })} />
        </>}
        {error && <p role="alert">{error}</p>}
        <div className="administrator-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditor(null); setPassword(''); setConfirmPassword(''); }}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
        </div>
      </form>}
    </Modal>
    <ConfirmDialog isOpen={Boolean(pending)} onClose={() => setPending(null)} onConfirm={() => void perform(pending.action, pending.person)}
      variant={pending?.action === 'delete' ? 'danger' : 'warning'} title={pending?.action === 'delete' ? tr('delete') : pending?.action === 'cancel' ? tr('cancelInvitation') : tr(pending?.person?.enabled ? 'suspend' : 'restore')}
      message={tr(pending?.action === 'delete' ? 'confirmDelete' : pending?.action === 'cancel' ? 'confirmCancel' : 'confirmStatus', { email: pending?.person?.email })}
      confirmText={t('common.confirm')} cancelText={t('common.cancel')} />
  </div>;
}
