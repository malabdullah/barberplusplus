import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  Smartphone,
  Check,
  AlertCircle,
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
} from 'lucide-react';
import { authService } from '../services/auth.service';
import { useApp } from '../context/AppContext';
import './Login.css';

export default function MFASetup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userRole } = useApp();

  const [step, setStep] = useState('loading'); // loading, status, enroll, verify, success
  const [enrollmentData, setEnrollmentData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [mfaStatus, setMfaStatus] = useState({ enabled: false, factors: [] });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    checkMfaStatus();
  }, []);

  const checkMfaStatus = async () => {
    try {
      const status = await authService.checkMfaStatus();
      setMfaStatus(status);
      setStep(status.enabled ? 'status' : 'enroll');
    } catch (err) {
      console.error('Failed to check MFA status:', err);
      setStep('enroll');
    }
  };

  const startEnrollment = async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await authService.enrollTotp();
      setEnrollmentData(data);
      setStep('verify');
    } catch (err) {
      setError(err.message || 'Failed to start MFA enrollment');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyEnrollment = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (verifyCode.length !== 6) {
      setError('Please enter a 6-digit code');
      setIsLoading(false);
      return;
    }

    try {
      await authService.verifyTotp(enrollmentData.id, verifyCode);
      setStep('success');
    } catch (err) {
      setError(err.message || 'Invalid verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const removeMfa = async (factorId) => {
    if (!window.confirm('Are you sure you want to disable two-factor authentication?')) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await authService.unenrollMfa(factorId);
      setMfaStatus({ enabled: false, factors: [] });
      setStep('enroll');
    } catch (err) {
      setError(err.message || 'Failed to disable MFA');
    } finally {
      setIsLoading(false);
    }
  };

  const copySecret = () => {
    if (enrollmentData?.secret) {
      navigator.clipboard.writeText(enrollmentData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getBackUrl = () => {
    if (userRole === 'admin') return '/admin/settings';
    if (userRole === 'barber') return '/barber/profile';
    return '/settings';
  };

  // Loading state
  if (step === 'loading') {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <div className="login-logo">
            <div className="login-logo-icon">
              <Loader2 size={28} className="animate-spin" />
            </div>
          </div>
          <div className="login-welcome">
            <p>{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  // MFA enabled status
  if (step === 'status') {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <button onClick={() => navigate(getBackUrl())} className="back-button">
            <ArrowLeft size={18} />
            {t('common.back')}
          </button>

          <div className="login-logo">
            <div className="login-logo-icon" style={{ background: 'var(--status-success)', color: 'white' }}>
              <Shield size={28} strokeWidth={2} />
            </div>
          </div>

          <div className="login-welcome">
            <h1>{t('mfa.enabled') || 'Two-Factor Authentication Enabled'}</h1>
            <p>{t('mfa.accountSecure') || 'Your account is protected with an authenticator app.'}</p>
          </div>

          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div style={{ marginTop: 'var(--space-lg)' }}>
            {mfaStatus.factors.map((factor) => (
              <div
                key={factor.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--space-md)',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-sm)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <Smartphone size={20} />
                  <span>{factor.friendly_name || 'Authenticator App'}</span>
                </div>
                <button
                  onClick={() => removeMfa(factor.id)}
                  disabled={isLoading}
                  style={{
                    background: 'var(--status-error)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-xs) var(--space-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-xs)',
                  }}
                >
                  <Trash2 size={14} />
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Success state
  if (step === 'success') {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <div className="login-logo">
            <div className="login-logo-icon" style={{ background: 'var(--status-success)', color: 'white' }}>
              <Check size={28} strokeWidth={2} />
            </div>
          </div>
          <div className="login-welcome">
            <h1>{t('mfa.setupComplete') || 'MFA Setup Complete!'}</h1>
            <p>{t('mfa.accountNowSecure') || 'Your account is now protected with two-factor authentication.'}</p>
          </div>
          <button onClick={() => navigate(getBackUrl())} className="login-submit">
            {t('common.back')}
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>
    );
  }

  // Verify step (QR code shown)
  if (step === 'verify') {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in" style={{ maxWidth: '420px' }}>
          <button onClick={() => setStep('enroll')} className="back-button">
            <ArrowLeft size={18} />
            {t('common.back')}
          </button>

          <div className="login-welcome">
            <h1>{t('mfa.scanQrCode') || 'Scan QR Code'}</h1>
            <p>{t('mfa.useAuthenticatorApp') || 'Open your authenticator app (Google Authenticator, Authy, etc.) and scan this QR code.'}</p>
          </div>

          {enrollmentData?.totp?.qr_code && (
            <div style={{ textAlign: 'center', margin: 'var(--space-lg) 0' }}>
              <img
                src={enrollmentData.totp.qr_code}
                alt="MFA QR Code"
                style={{
                  width: '200px',
                  height: '200px',
                  borderRadius: 'var(--radius-md)',
                  background: 'white',
                  padding: 'var(--space-sm)',
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
              {t('mfa.cantScanQr') || "Can't scan? Enter this code manually:"}
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                background: 'var(--bg-secondary)',
                padding: 'var(--space-sm) var(--space-md)',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'monospace',
              }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>
                {showSecret ? enrollmentData?.totp?.secret : '••••••••••••••••'}
              </span>
              <button onClick={() => setShowSecret(!showSecret)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <button onClick={copySecret} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Copy size={18} color={copied ? 'var(--status-success)' : undefined} />
              </button>
            </div>
          </div>

          <form onSubmit={verifyEnrollment}>
            {error && (
              <div className="login-error animate-fade-in">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="login-field">
              <label>{t('mfa.verificationCode') || 'Verification Code'}</label>
              <div className="login-input-wrapper">
                <Shield size={18} strokeWidth={1.5} />
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  style={{ textAlign: 'center', letterSpacing: '0.5em', fontSize: '1.2em' }}
                  autoFocus
                />
              </div>
            </div>

            <button type="submit" className="login-submit" disabled={isLoading || verifyCode.length !== 6}>
              {isLoading ? (
                <span className="login-loading">{t('common.loading')}</span>
              ) : (
                <>
                  {t('mfa.verify') || 'Verify & Enable MFA'}
                  <Check size={18} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Enroll step (start)
  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>
      <div className="login-container animate-scale-in">
        <button onClick={() => navigate(getBackUrl())} className="back-button">
          <ArrowLeft size={18} />
          {t('common.back')}
        </button>

        <div className="login-logo">
          <div className="login-logo-icon">
            <Shield size={28} strokeWidth={1.5} />
          </div>
        </div>

        <div className="login-welcome">
          <h1>{t('mfa.setupTitle') || 'Two-Factor Authentication'}</h1>
          <p>{t('mfa.setupDescription') || 'Add an extra layer of security to your account by enabling two-factor authentication with an authenticator app.'}</p>
        </div>

        {error && (
          <div className="login-error animate-fade-in">
            {error}
          </div>
        )}

        <div style={{ margin: 'var(--space-lg) 0', padding: 'var(--space-md)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          <h3 style={{ marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Smartphone size={20} />
            {t('mfa.requirements') || 'Requirements'}
          </h3>
          <ul style={{ paddingLeft: 'var(--space-lg)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            <li>{t('mfa.requirement1') || 'A smartphone with an authenticator app'}</li>
            <li>{t('mfa.requirement2') || 'Google Authenticator, Authy, or similar'}</li>
            <li>{t('mfa.requirement3') || 'The app will generate 6-digit codes'}</li>
          </ul>
        </div>

        <button onClick={startEnrollment} className="login-submit" disabled={isLoading}>
          {isLoading ? (
            <span className="login-loading">{t('common.loading')}</span>
          ) : (
            <>
              {t('mfa.enableMfa') || 'Enable Two-Factor Authentication'}
              <Shield size={18} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
