import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MapPin, Bell, Settings, ArrowRight } from 'lucide-react';
import './AdminPages.css';

export default function SystemConfiguration() {
  const { t } = useTranslation();

  const sections = [
    {
      icon: MapPin,
      title: t('admin.config.locations'),
      description: t('admin.config.locationsDesc'),
      path: '/admin/configuration/locations',
    },
    {
      icon: Bell,
      title: t('admin.config.templates'),
      description: t('admin.config.templatesDesc'),
      path: '/admin/configuration/templates',
    },
    {
      icon: Settings,
      title: t('admin.config.settings'),
      description: t('admin.config.settingsDesc'),
      path: '/admin/configuration/settings',
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{t('admin.config.title')}</h1>
        <p>{t('admin.config.subtitle')}</p>
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
