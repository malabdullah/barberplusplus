import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
export default function AccountAccessState({ access }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token !== access.session?.access_token) { access.retry(); return; }
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (!error) navigate('/customer/sign-in', { replace: true });
    } finally { setBusy(false); }
  };
  if (access.loading) return <p role="status" className="account-tools-status"><Loader2 className="cb-spinner" size={20} aria-hidden="true" />{t('common.loading')}</p>;
  if (access.error === 'ADMIN_MFA_REQUIRED') return <Navigate to="/mfa-setup" replace />;
  if (!access.session) return <Navigate to="/customer/sign-in" state={{ returnTo: '/customer/account' }} replace />;
  if (access.error === 'AUTH_REQUIRED') return <p role="alert">{t('accountTools.sessionExpired')} <button type="button" className="cb-secondary" disabled={busy} onClick={signIn}>{t('accountTools.signInAgain')}</button></p>;
  return <p role="alert">{t('accountTools.loadFailed')} <button className="cb-secondary" onClick={access.retry}>{t('common.retry')}</button> <Link to="/">{t('common.brandHome')}</Link></p>;
}
