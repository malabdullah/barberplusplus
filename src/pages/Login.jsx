import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getErrorMessage, logErrorSafely } from '../utils/errorMessages';
import { usePublicNavigationBusy } from '../components/Public/PublicNavigationContext';
import CustomerAuthLayout from '../components/Customer/CustomerAuthLayout';
import CustomerSocialButtons from '../components/Customer/CustomerSocialButtons';
import { teamAuthService, staffDestination } from '../services/teamAuth.service';

export default function Login() {
  const { t } = useTranslation(); const navigate = useNavigate(); const { login } = useApp();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState(''); const [isLoading, setIsLoading] = useState(false);
  usePublicNavigationBusy(isLoading);
  const update = event => { setFormData(current => ({ ...current, [event.target.name]: event.target.value })); setError(''); };
  const submit = async event => {
    event.preventDefault(); if (isLoading) return;
    if (!formData.email.trim() || !formData.password) { setError(t('validation.emailPasswordRequired')); return; }
    setIsLoading(true); setError('');
    try {
      const role = await login(formData.email.trim(), formData.password);
      if (role) navigate(staffDestination(role), { replace: true });
      else { setError(t('auth.invalidCredentials')); setIsLoading(false); }
    } catch (failure) { logErrorSafely(failure, 'Login.handleSubmit'); setError(getErrorMessage(failure, t('auth.invalidCredentials'))); setIsLoading(false); }
  };
  return <CustomerAuthLayout accountType="team" title={t('publicNav.teamSignIn')} intro={t('teamAuth.intro')}>
    <CustomerSocialButtons authService={teamAuthService} disabled={isLoading} hint={t('teamAuth.socialHint')} />
    {error && <p className="cb-alert" role="alert">{error}</p>}
    <form onSubmit={submit} noValidate><fieldset className="cb-details-fields" disabled={isLoading}>
      <div className="ca-field"><label className="cb-field-label" htmlFor="email">{t('customerAuth.email.label')}</label><input className="cb-input" id="email" name="email" type="email" dir="ltr" autoComplete="email" value={formData.email} onChange={update} required /></div>
      <div className="ca-field"><label className="cb-field-label" htmlFor="password">{t('auth.password')}</label><div className="ca-password"><input className="cb-input" id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={formData.password} onChange={update} required /><button type="button" aria-label={t(`customerAuth.${showPassword ? 'hidePassword' : 'showPassword'}`)} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>
      <Link to="/forgot-password" className="cb-text-button ca-forgot">{t('auth.forgotPassword')}</Link>
      <button type="submit" className="cb-primary ca-submit" disabled={isLoading}>{isLoading && <Loader2 className="cb-spinner" size={18} aria-hidden="true" />}{t('auth.signIn')}</button>
    </fieldset></form>
    <p className="ca-switch">{t('auth.noAccount')} <Link to="/signup">{t('publicNav.registerShop')}</Link></p>
  </CustomerAuthLayout>;
}
