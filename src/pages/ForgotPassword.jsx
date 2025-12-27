import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Scissors, Mail, ArrowRight, ArrowLeft, CheckCircle } from 'lucide-react';
import './Login.css';
import './ForgotPassword.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleChange = (e) => {
    setEmail(e.target.value);
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setIsLoading(false);
    setIsSuccess(true);
  };

  return (
    <div className="login-page">
      {/* Background Pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>

      {/* Forgot Password Container */}
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

        {isSuccess ? (
          /* Success State */
          <div className="forgot-success animate-fade-in">
            <div className="forgot-success-icon">
              <CheckCircle size={48} strokeWidth={1.5} />
            </div>
            <h1>Check your email</h1>
            <p>
              We've sent a password reset link to <strong>{email}</strong>.
              Please check your inbox and follow the instructions.
            </p>
            <div className="forgot-success-note">
              <p>Didn't receive the email? Check your spam folder or try again.</p>
            </div>
            <Link to="/login" className="login-submit">
              <ArrowLeft size={18} strokeWidth={2} />
              Back to Sign In
            </Link>
          </div>
        ) : (
          <>
            {/* Welcome Text */}
            <div className="login-welcome">
              <h1>Forgot Password?</h1>
              <p>Enter your email to receive a reset link</p>
            </div>

            {/* Forgot Password Form */}
            <form className="login-form" onSubmit={handleSubmit}>
              {error && (
                <div className="login-error animate-fade-in">
                  {error}
                </div>
              )}

              <div className="login-field">
                <label htmlFor="email">Email Address</label>
                <div className="login-input-wrapper">
                  <Mail size={18} strokeWidth={1.5} />
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={email}
                    onChange={handleChange}
                    placeholder="your@email.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="login-submit"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="login-loading">Sending...</span>
                ) : (
                  <>
                    Send Reset Link
                    <ArrowRight size={18} strokeWidth={2} />
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="login-footer">
              <p>
                <Link to="/login" className="forgot-back-link">
                  <ArrowLeft size={14} strokeWidth={2} />
                  Back to Sign In
                </Link>
              </p>
            </div>
          </>
        )}
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
