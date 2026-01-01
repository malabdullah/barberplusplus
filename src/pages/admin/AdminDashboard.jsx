import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Users,
  Building2,
  Calendar,
  TrendingUp,
  UserCheck,
  Scissors,
  ArrowRight,
  Activity,
  Shield,
  Settings2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { adminService } from '../../services/admin.service';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { user } = useApp();
  const [metrics, setMetrics] = useState({
    totalManagers: 0,
    totalBarbers: 0,
    totalBranches: 0,
    totalBookings: 0,
    activeBookingsToday: 0,
    weeklyRevenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const data = await adminService.getPlatformMetrics();
        setMetrics(data);
      } catch (error) {
        console.error('Error loading platform metrics:', error);
      } finally {
        setLoading(false);
      }
    };
    loadMetrics();
  }, []);

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard.greeting.morning');
    if (hour < 18) return t('dashboard.greeting.afternoon');
    return t('dashboard.greeting.evening');
  };

  const quickActions = [
    {
      icon: Users,
      label: t('admin.quickActions.manageUsers'),
      path: '/admin/users',
      color: 'blue',
    },
    {
      icon: Activity,
      label: t('admin.quickActions.viewAnalytics'),
      path: '/admin/analytics',
      color: 'green',
    },
    {
      icon: Settings2,
      label: t('admin.quickActions.configure'),
      path: '/admin/configuration',
      color: 'amber',
    },
    {
      icon: Shield,
      label: t('admin.quickActions.auditLogs'),
      path: '/admin/audit',
      color: 'purple',
    },
  ];

  return (
    <div className="admin-dashboard">
      {/* Header */}
      <div className="admin-dashboard-header">
        <div className="admin-dashboard-greeting">
          <h1>{getGreeting()}, {user?.user_metadata?.name || 'Admin'}</h1>
          <p>{t('admin.dashboard.subtitle')}</p>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="admin-metrics-grid">
        <div className="admin-metric-card">
          <div className="admin-metric-icon blue">
            <Users size={24} />
          </div>
          <div className="admin-metric-content">
            <span className="admin-metric-value">
              {loading ? '...' : metrics.totalManagers}
            </span>
            <span className="admin-metric-label">{t('admin.metrics.totalManagers')}</span>
          </div>
        </div>

        <div className="admin-metric-card">
          <div className="admin-metric-icon green">
            <UserCheck size={24} />
          </div>
          <div className="admin-metric-content">
            <span className="admin-metric-value">
              {loading ? '...' : metrics.totalBarbers}
            </span>
            <span className="admin-metric-label">{t('admin.metrics.totalBarbers')}</span>
          </div>
        </div>

        <div className="admin-metric-card">
          <div className="admin-metric-icon amber">
            <Building2 size={24} />
          </div>
          <div className="admin-metric-content">
            <span className="admin-metric-value">
              {loading ? '...' : metrics.totalBranches}
            </span>
            <span className="admin-metric-label">{t('admin.metrics.totalBranches')}</span>
          </div>
        </div>

        <div className="admin-metric-card">
          <div className="admin-metric-icon purple">
            <Calendar size={24} />
          </div>
          <div className="admin-metric-content">
            <span className="admin-metric-value">
              {loading ? '...' : metrics.activeBookingsToday}
            </span>
            <span className="admin-metric-label">{t('admin.metrics.todayBookings')}</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="admin-section">
        <h2 className="admin-section-title">{t('admin.quickActions.title')}</h2>
        <div className="admin-quick-actions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.path}
                to={action.path}
                className={`admin-quick-action ${action.color}`}
              >
                <div className="admin-quick-action-icon">
                  <Icon size={24} />
                </div>
                <span className="admin-quick-action-label">{action.label}</span>
                <ArrowRight size={16} className="admin-quick-action-arrow" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="admin-section">
        <div className="admin-section-header">
          <h2 className="admin-section-title">{t('admin.recentActivity.title')}</h2>
          <Link to="/admin/audit/activity" className="admin-section-link">
            {t('common.viewAll')} <ArrowRight size={14} />
          </Link>
        </div>
        <div className="admin-activity-placeholder">
          <Activity size={48} />
          <p>{t('admin.recentActivity.noActivity')}</p>
        </div>
      </div>
    </div>
  );
}
