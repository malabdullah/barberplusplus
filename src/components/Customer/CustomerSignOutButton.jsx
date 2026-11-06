import React from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './CustomerSignOutButton.css';

export default function CustomerSignOutButton({ pending = false, disabled = false, onClick }) {
  const { t } = useTranslation();
  return <button type="button" className="customer-sign-out" disabled={disabled || pending} aria-busy={pending} onClick={onClick}>
    {pending ? <Loader2 size={18} className="cb-spinner" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}
    <span>{t(pending ? 'customerAuth.signingOut' : 'customerAuth.signOut')}</span>
  </button>;
}
