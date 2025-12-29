import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Lock, Eye, EyeOff, ArrowRight, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notificationsService } from '../services';
import './Login.css';

export default function AcceptInvite() {
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [userName, setUserName] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    // Check for existing session (set by Supabase after clicking invite link)
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUserName(session.user.user_metadata?.name || '');

          // If user already accepted invite, redirect to dashboard
          if (session.user.user_metadata?.invite_accepted) {
            navigate('/barber');
            return;
          }
        }
      } catch (err) {
        console.error('Error checking session:', err);
      }
      setIsCheckingSession(false);
    };

    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        if (session?.user) {
          setUserName(session.user.user_metadata?.name || '');
          setIsCheckingSession(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const validateForm = () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
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
        password: password,
        data: { invite_accepted: true }
      });

      if (updateError) throw updateError;

      // Update barber record to mark invite as accepted
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.barberId) {
        // Get barber details for notification
        const { data: barberData } = await supabase
          .from('barbers')
          .select('name, branch_id')
          .eq('id', user.user_metadata.barberId)
          .single();

        await supabase
          .from('barbers')
          .update({
            invite_status: 'accepted',
            invite_accepted_at: new Date().toISOString()
          })
          .eq('id', user.user_metadata.barberId);

        // Create notification for manager
        if (barberData?.branch_id) {
          notificationsService.create({
            recipientBranchId: barberData.branch_id,
            recipientRole: 'manager',
            type: 'barber_invite_accepted',
            title: 'New Team Member',
            message: `${barberData.name || userName || 'A barber'} has accepted your invitation and joined the team`,
            entityType: 'barber',
            entityId: user.user_metadata.barberId,
            metadata: {
              barberName: barberData.name || userName,
            },
          }).catch(err => console.error('Error creating invite accepted notification:', err));
        }
      }

      setIsSuccess(true);

      // Redirect to barber dashboard after short delay
      setTimeout(() => {
        navigate('/barber');
      }, 2000);

    } catch (err) {
      console.error('Error setting password:', err);
      setError(err.message || 'Failed to set password. Please try again.');
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
          <div className="login-logo">
            <div className="login-logo-icon">
              <Scissors size={28} strokeWidth={1.5} />
            </div>
          </div>
          <div className="login-welcome">
            <p>Loading...</p>
          </div>
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
            <h1>Welcome to Barber++!</h1>
            <p>Your account is ready. Redirecting to your dashboard...</p>
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
        <div className="login-logo">
          <div className="login-logo-icon">
            <Scissors size={28} strokeWidth={1.5} />
          </div>
          <div className="login-logo-text">
            <span className="login-logo-name">Barber++</span>
            <span className="login-logo-tagline">Dashboard</span>
          </div>
        </div>

        {/* Decorative Line */}
        <div className="login-divider">
          <div className="login-divider-line"></div>
          <div className="login-divider-diamond"></div>
          <div className="login-divider-line"></div>
        </div>

        {/* Welcome Text */}
        <div className="login-welcome">
          <h1>Welcome{userName ? `, ${userName}` : ''}!</h1>
          <p>Set your password to complete your account setup</p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="password">Create Password</label>
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
                placeholder="At least 8 characters"
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
            <label htmlFor="confirmPassword">Confirm Password</label>
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
                placeholder="Confirm your password"
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
              <span className="login-loading">Setting up...</span>
            ) : (
              <>
                Complete Setup
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
