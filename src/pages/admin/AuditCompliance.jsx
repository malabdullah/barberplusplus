import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Activity, Shield, ArrowRight } from 'lucide-react';
import './AdminPages.css';

export default function AuditCompliance() {
  const { t } = useTranslation();

  const sections = [
    {
      icon: Activity,
      title: t('admin.audit.activity'),
      description: t('admin.audit.activityDesc'),
      path: '/admin/audit/activity',
    },
    {
      icon: Shield,
      title: t('admin.audit.security'),
      description: t('admin.audit.securityDesc'),
      path: '/admin/audit/security',
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{t('admin.audit.title')}</h1>
        <p>{t('admin.audit.subtitle')}</p>
      </div>

      <div className="admin-cards-grid">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.path} to={section.path} className="admin-card-link">
              <div className="admin-card">
                <div className="admin-card-icon">
                  <Icon size={28} />
                </div>
                <div className="admin-card-content">
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                </div>
                <ArrowRight size={20} className="admin-card-arrow" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
