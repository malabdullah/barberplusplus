import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Briefcase, UserRound } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { customerFeaturesEnabled } from '../../lib/runtimeConfig';
import { workDestination } from '../../lib/accountSession';
import './AccountModeSwitch.css';

export default function AccountModeSwitch({ personal = false, full = false, disabled = false }) {
  const { t } = useTranslation();
  const { userRole } = useApp();
  const customerWorkspace = workDestination(userRole);
  const workspace = customerWorkspace || { admin: '/admin', agent: '/agent' }[userRole];
  if (!workspace || (!personal && (!customerFeaturesEnabled || !customerWorkspace))) return null;
  const label = t(personal ? 'accountMode.toWork' : 'accountMode.toCustomer');
  const Icon = personal ? Briefcase : UserRound;
  return <Link to={personal ? workspace : '/customer/account'} className={`account-mode-switch${full ? ' account-mode-full' : ''}`} title={label} aria-label={label} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} onClick={event => { if (disabled) event.preventDefault(); }}>
    <Icon size={20} aria-hidden="true" /><span>{label}</span>
  </Link>;
}
