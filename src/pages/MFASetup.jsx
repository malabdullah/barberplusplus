import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authService } from '../services/auth.service';
import { useApp } from '../context/AppContext';
import { staffMfaReturn } from '../lib/staffMfaReturn';
import './CustomerAuth.css';
import './AccountTools.css';

export default function MFASetup() {
  const { t } = useTranslation();
  const { adminVerified, logout, user, userRole } = useApp();
  const navigate = useNavigate();
  const [factor, setFactor] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    authService.checkMfaStatus().then(status => {
      if (active) setFactor(status.factors[0] || null);
    }).catch(() => {
      if (active) setLoadError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [attempt, user?.id]);

  const startEnrollment = async () => {
    setBusy(true);
    setError('');
    try {
      const factors = await authService.getMfaFactors();
      const verified = factors.totp.find(item => item.status === 'verified');
      if (verified) setFactor(verified);
      else {
        // Discard setup attempts left unfinished by a reload or closed tab.
        for (const item of factors.all.filter(item => item.factor_type === 'totp' && item.status === 'unverified')) {
          await authService.unenrollMfa(item.id);
        }
        setEnrollment(await authService.enrollTotp());
      }
    } catch { setError('mfa.setupFailed'); }
    finally { setBusy(false); }
  };

  const verify = async event => {
    event.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      await authService.verifyTotp(enrollment?.id || factor.id, code);
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      navigate(returnTo ? staffMfaReturn(returnTo) : ({admin:'/admin',manager:'/dashboard',barber:'/barber',agent:'/agent'})[userRole] || '/login', { replace: true });
    } catch {
      setCode('');
      setError('mfa.invalidCode');
    } finally { setBusy(false); }
  };

  return (
    <main className="ca-main">
      <section className="ca-panel">
        <h1>{t('mfa.setupTitle')}</h1>
        {loading ? <p role="status">{t('common.loading')}</p> : loadError ? (
          <>
            <p role="alert">{t('mfa.setupFailed')}</p>
            <button type="button" className="cb-secondary" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button>
          </>
        ) : adminVerified ? (
          <>
            <p>{t('mfa.accountSecure')}</p>
            <Link className="cb-secondary" to={userRole === 'admin' ? '/admin/settings' : '/dashboard'}>{t('common.back')}</Link>
          </>
        ) : factor || enrollment ? (
          <>
            {enrollment && (
              <>
                <p>{t('mfa.useAuthenticatorApp')}</p>
                <img className="mfa-qr" src={enrollment.totp.qr_code} alt={t('mfa.scanQrCode')} width="200" height="200" />
                <details className="mfa-manual-key">
                  <summary>{t('mfa.cantScanQr')}</summary>
                  <code dir="ltr">{enrollment.totp.secret}</code>
                </details>
              </>
            )}
            <form className="ca-form" onSubmit={verify}>
              <label>
                {t('mfa.enterCode')}
                <input className="form-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
                  value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>{t(enrollment ? 'mfa.verify' : 'mfa.verifyIdentity')}</button>
            </form>
          </>
        ) : (
          <>
            <p>{t('mfa.adminSetup')}</p>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={startEnrollment}>{t('mfa.enableMfa')}</button>
          </>
        )}
        {error && <p role="alert">{t(error)}</p>}
        {!adminVerified && <button className="cb-secondary" type="button" disabled={busy} onClick={logout}>{t('customerAuth.signOut')}</button>}
      </section>
    </main>
  );
}
