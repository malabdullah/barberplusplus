import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { validatePassword } from '../utils/validation';
import './admin/AdminPages.css';

export default function ChangePassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (!validatePassword(password).valid || new TextEncoder().encode(password).length > 72 || password !== confirm) { setError(t('admin.passwordReset.ownInvalid')); return; }
    setBusy(true);
    try {
      const result = await supabase.auth.updateUser({password});
      if (result.error) throw result.error;
      setPassword(''); setConfirm(''); setSuccess(true);
    } catch { setError(t('admin.passwordReset.failed')); }
    finally { setBusy(false); }
  };
  return <main className="admin-page">
    <div className="admin-page-header"><button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>{t('common.back')}</button><h1>{t('settings.changePassword')}</h1></div>
    <form className="password-reset-form" onSubmit={submit}>
      <label htmlFor="own-password">{t('admin.passwordReset.password')}</label>
      <input id="own-password" className="form-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
      <label htmlFor="own-confirm">{t('admin.passwordReset.confirm')}</label>
      <input id="own-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required disabled={busy} />
      <p>{t('admin.passwordReset.rules')}</p>
      {error && <p role="alert" className="password-reset-error">{error}</p>}
      {success && <p role="status">{t('admin.passwordReset.ownSuccess')}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('common.saving') : t('settings.changePassword')}</button>
    </form>
  </main>;
}
