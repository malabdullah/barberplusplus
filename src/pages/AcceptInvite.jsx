import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, Lock, Eye, EyeOff, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notificationsService } from '../services';
import { logErrorDev } from '../utils/security';
import { validatePassword } from '../utils/validation';
import './Login.css';

export default function AcceptInvite() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [userName, setUserName] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isValidInvite, setIsValidInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    // Check for existing session and validate barber invite
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const role = session.user.app_metadata?.role;
          if (role !== 'barber') {
            setInviteError(t('auth.invalidInviteLink') || 'Invalid invite link');
            setIsCheckingSession(false);
            return;
          }

          // SECURITY: Resolve ownership through the database assignment. User
          // metadata is editable by the account holder and is not authoritative.
          const { data: barber, error: barberError } = await supabase
            .from('barbers')
            .select('id, invite_status, name')
            .eq('user_id', session.user.id)
            .single();

          if (barberError || !barber) {
            setInviteError(t('auth.invalidInviteLink') || 'Invalid invite link');
            setIsCheckingSession(false);
            return;
          }

          if (barber.invite_status === 'accepted') {
            // Already accepted, redirect
            navigate('/barber');
            return;
          }

          if (barber.invite_status !== 'sent' && barber.invite_status !== 'pending') {
            setInviteError(t('auth.inviteExpired') || 'This invite is no longer valid');
            setIsCheckingSession(false);
            return;
          }

          // Invite is valid
          setUserName(barber.name || session.user.user_metadata?.name || '');
          setIsValidInvite(true);
        }
      } catch (err) {
        setInviteError(t('auth.invalidInviteLink') || 'Failed to verify invite');
      }
      setIsCheckingSession(false);
    };

    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        if (session?.user) {
          if (session.user.app_metadata?.role !== 'barber') {
            setInviteError(t('auth.invalidInviteLink') || 'Invalid invite link');
            setIsCheckingSession(false);
            return;
          }

          // Verify barber record
          const { data: barber } = await supabase
            .from('barbers')
            .select('id, invite_status, name')
            .eq('user_id', session.user.id)
            .single();

          if (barber && (barber.invite_status === 'sent' || barber.invite_status === 'pending')) {
            setUserName(barber.name || session.user.user_metadata?.name || '');
            setIsValidInvite(true);
          }
          setIsCheckingSession(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, t]);

  const validateForm = () => {
    // SECURITY: Use full password validation, not just length check
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message);
      return false;
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      // Update the user's password
      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      });

      if (updateError) throw updateError;

      // Update barber record to mark invite as accepted
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id && user.app_metadata?.role === 'barber') {
        // Get barber details for notification
        const { data: barberData } = await supabase
          .from('barbers')
          .select('id, name, branch_id')
          .eq('user_id', user.id)
          .single();

        if (!barberData) throw new Error('No barber assignment was found for this account.');

        await supabase
          .from('barbers')
          .update({
            invite_status: 'accepted',
            invite_accepted_at: new Date().toISOString()
          })
          .eq('id', barberData.id)
          .eq('user_id', user.id);

        // Create notification for manager
        if (barberData?.branch_id) {
          notificationsService.create({
            recipientBranchId: barberData.branch_id,
            recipientRole: 'manager',
            type: 'barber_invite_accepted',
            title: 'New Team Member',
            message: `${barberData.name || userName || 'A barber'} has accepted your invitation and joined the team`,
            entityType: 'barber',
            entityId: barberData.id,
            metadata: {
              barberName: barberData.name || userName,
            },
          }).catch(err => logErrorDev('Error creating invite accepted notification:', err));
        }
      }

      setIsSuccess(true);

      // Redirect to barber dashboard after short delay
      setTimeout(() => {
        navigate('/barber');
      }, 2000);

    } catch (err) {
      logErrorDev('Error setting password:', err);
      setError(err.message || t('errors.setPasswordFailed'));
      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <Link to="/" className="login-logo" aria-label="Barber++ Home">
            <div className="login-logo-icon">
              <Scissors size={28} strokeWidth={1.5} />
            </div>
          </Link>
          <div className="login-welcome">
            <p>{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  // Invalid or expired invite error
  if (inviteError || (!isValidInvite && !isCheckingSession)) {
    return (
      <div className="login-page">
        <div className="login-bg">
          <div className="login-bg-gradient" />
          <div className="login-bg-pattern" />
        </div>
        <div className="login-container animate-scale-in">
          <div className="login-logo">
            <div className="login-logo-icon" style={{ background: 'var(--status-error)', color: 'white' }}>
              <AlertCircle size={28} strokeWidth={2} />
            </div>
          </div>
          <div className="login-welcome">
            <h1>{t('auth.invalidInviteTitle') || 'Invalid Invite'}</h1>
            <p>{inviteError || t('auth.inviteExpired') || 'This invite link is invalid or has expired.'}</p>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="login-submit"
          >
            {t('auth.goToLogin') || 'Go to Login'}
            <ArrowRight size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  if (isSuccess) {
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
            <h1>{t('auth.welcomeToBarber')}</h1>
            <p>{t('auth.accountReadyRedirecting')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      {/* Background Pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>

      {/* Container */}
      <div className="login-container animate-scale-in">
        {/* Logo */}
        <Link to="/" className="login-logo" aria-label="Barber++ Home">
          <div className="login-logo-icon">
            <Scissors size={28} strokeWidth={1.5} />
          </div>
          <div className="login-logo-text">
            <span className="login-logo-name">Barber++</span>
            <span className="login-logo-tagline">Dashboard</span>
          </div>
        </Link>

        {/* Decorative Line */}
        <div className="login-divider">
          <div className="login-divider-line"></div>
          <div className="login-divider-diamond"></div>
          <div className="login-divider-line"></div>
        </div>

        {/* Welcome Text */}
        <div className="login-welcome">
          <h1>{t('auth.welcome')}{userName ? `, ${userName}` : ''}!</h1>
          <p>{t('auth.setPasswordToComplete')}</p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="password">{t('auth.createPassword')}</label>
            <div className="login-input-wrapper">
              <Lock size={18} strokeWidth={1.5} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder={t('auth.atLeast8Chars')}
                autoComplete="new-password"
                required
                minLength={8}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff size={18} strokeWidth={1.5} />
                ) : (
                  <Eye size={18} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
            <div className="login-input-wrapper">
              <Lock size={18} strokeWidth={1.5} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder={t('auth.confirmYourPassword')}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="login-loading">{t('auth.settingUp')}</span>
            ) : (
              <>
                {t('auth.completeSetup')}
                <ArrowRight size={18} strokeWidth={2} />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Floating Elements */}
      <div className="login-float login-float-1">
        <Scissors size={32} strokeWidth={1} />
      </div>
      <div className="login-float login-float-2">
        <Scissors size={24} strokeWidth={1} />
      </div>
      <div className="login-float login-float-3">
        <Scissors size={20} strokeWidth={1} />
      </div>
    </div>
  );
}
