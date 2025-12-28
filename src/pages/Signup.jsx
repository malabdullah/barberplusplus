import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Scissors, Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GCC_COUNTRIES } from '../constants/countries';
import './Login.css';
import './Signup.css';

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useApp();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    countryCode: '+965',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError('Please enter your full name');
      return false;
    }
    if (!formData.email.trim()) {
      setError('Please enter your email');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!formData.phone.trim()) {
      setError('Please enter your phone number');
      return false;
    }
    // Strong password validation
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }
    if (!/[A-Z]/.test(formData.password)) {
      setError('Password must contain at least one uppercase letter');
      return false;
    }
    if (!/[a-z]/.test(formData.password)) {
      setError('Password must contain at least one lowercase letter');
      return false;
    }
    if (!/[0-9]/.test(formData.password)) {
      setError('Password must contain at least one number');
      return false;
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(formData.password)) {
      setError('Password must contain at least one special character');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsLoading(true);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await signup({
      name: formData.name,
      email: formData.email,
      phone: `${formData.countryCode} ${formData.phone}`,
      password: formData.password,
    });

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error || 'Registration failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Background Pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-pattern" />
      </div>

      {/* Signup Container */}
      <div className="login-container signup-container animate-scale-in">
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
          <h1>Create Account</h1>
          <p>Sign up to manage your barbershops</p>
        </div>

        {/* Signup Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="name">Full Name</label>
            <div className="login-input-wrapper">
              <User size={18} strokeWidth={1.5} />
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="John Doe"
                autoComplete="name"
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="email">Email</label>
            <div className="login-input-wrapper">
              <Mail size={18} strokeWidth={1.5} />
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="your@email.com"
                autoComplete="email"
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="phone">Phone Number</label>
            <div className="signup-phone-wrapper">
              <select
                name="countryCode"
                value={formData.countryCode}
                onChange={handleChange}
                className="signup-country-select"
              >
                {GCC_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
              <div className="login-input-wrapper signup-phone-input">
                <Phone size={18} strokeWidth={1.5} />
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="XXXX XXXX"
                  autoComplete="tel"
                />
              </div>
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="login-input-wrapper">
              <Lock size={18} strokeWidth={1.5} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Min. 8 chars, uppercase, number, special"
                autoComplete="new-password"
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
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Repeat password"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff size={18} strokeWidth={1.5} />
                ) : (
                  <Eye size={18} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="login-loading">Creating account...</span>
            ) : (
              <>
                Create Account
                <ArrowRight size={18} strokeWidth={2} />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="login-footer">
          <p>Already have an account? <Link to="/login">Sign in</Link></p>
        </div>
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
