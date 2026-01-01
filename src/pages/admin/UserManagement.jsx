import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Users, UserCheck, ArrowRight } from 'lucide-react';
import { adminService } from '../../services/admin.service';
import './AdminPages.css';

export default function UserManagement() {
  const { t } = useTranslation();
  const [counts, setCounts] = useState({ managers: '-', barbers: '-' });

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const [managersResult, barbersResult] = await Promise.all([
          adminService.getAllManagers({}),
          adminService.getAllBarbers({ limit: 1 }),
        ]);
        setCounts({
          managers: managersResult.total || 0,
          barbers: barbersResult.total || 0,
        });
      } catch (error) {
        console.error('Error loading counts:', error);
      }
    };
    loadCounts();
  }, []);

  const sections = [
    {
      icon: Users,
      title: t('admin.users.managers'),
      description: t('admin.users.managersDesc'),
      path: '/admin/users/managers',
      count: counts.managers,
    },
    {
      icon: UserCheck,
      title: t('admin.users.barbers'),
      description: t('admin.users.barbersDesc'),
      path: '/admin/users/barbers',
      count: counts.barbers,
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>{t('admin.users.title')}</h1>
        <p>{t('admin.users.subtitle')}</p>
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
                  {section.count !== '-' && (
                    <span className="admin-card-count">{section.count}</span>
                  )}
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
