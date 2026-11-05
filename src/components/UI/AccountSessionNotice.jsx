import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACCOUNT_NOTICE_KEY } from '../../lib/accountSession';
import './AccountModeSwitch.css';

export default function AccountSessionNotice() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => { try { return localStorage.getItem(ACCOUNT_NOTICE_KEY) === '1'; } catch { return false; } });
  if (!visible) return null;
  return <div className="account-session-notice" role="status">{t('accountMode.legacyNotice')}
    <button type="button" onClick={() => { localStorage.removeItem(ACCOUNT_NOTICE_KEY); setVisible(false); }}>{t('common.close')}</button>
  </div>;
}
