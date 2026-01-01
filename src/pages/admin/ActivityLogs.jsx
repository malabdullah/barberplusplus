import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import './AdminPages.css';

export default function ActivityLogs() {
  const { t } = useTranslation();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{t('admin.audit.activity')}</h1>
        <p>{t('admin.audit.activityDesc')}</p>
      </div>

      <div className="admin-placeholder">
        <div className="admin-placeholder-icon">
          <Activity size={40} />
        </div>
        <h2>{t('admin.comingSoon')}</h2>
        <p>{t('admin.comingSoonDesc')}</p>
      </div>
    </div>
  );
}
