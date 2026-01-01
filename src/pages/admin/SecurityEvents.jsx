import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shield } from 'lucide-react';
import './AdminPages.css';

export default function SecurityEvents() {
  const { t } = useTranslation();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{t('admin.audit.security')}</h1>
        <p>{t('admin.audit.securityDesc')}</p>
      </div>

      <div className="admin-placeholder">
        <div className="admin-placeholder-icon">
          <Shield size={40} />
        </div>
        <h2>{t('admin.comingSoon')}</h2>
        <p>{t('admin.comingSoonDesc')}</p>
      </div>
    </div>
  );
}
