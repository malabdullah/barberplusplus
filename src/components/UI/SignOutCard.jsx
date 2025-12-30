import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import ConfirmDialog from './ConfirmDialog';
import './SignOutCard.css';

export default function SignOutCard() {
  const { t } = useTranslation();
  const { logout } = useApp();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <div className="signout-card">
        {/* Subtle top accent line */}
        <div className="signout-card-accent" />

        <div className="signout-card-header">
          <div className="signout-card-icon">
            <LogOut size={16} strokeWidth={1.5} />
          </div>
          <div className="signout-card-title">{t('auth.signOut')}</div>
        </div>

        <p className="signout-card-desc">{t('settings.signOutDescShort')}</p>

        <button
          className="signout-card-btn"
          onClick={() => setShowConfirm(true)}
        >
          <span>{t('auth.signOut')}</span>
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={logout}
        title={t('settings.signOutConfirmTitle')}
        message={t('settings.signOutConfirmMessage')}
        confirmText={t('auth.signOut')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </>
  );
}
