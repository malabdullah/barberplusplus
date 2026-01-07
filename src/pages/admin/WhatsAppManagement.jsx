import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  MessageCircle,
  MessagesSquare,
  FileText,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { adminService } from '../../services/admin.service';
import './AdminPages.css';
import './WhatsAppPages.css';

export default function WhatsAppManagement() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const result = await adminService.getWhatsAppStats();
      setStats(result);
    } catch (error) {
      console.error('Error loading WhatsApp stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const sections = [
    {
      icon: MessagesSquare,
      title: t('admin.whatsapp.conversations'),
      description: t('admin.whatsapp.conversationsDesc'),
      path: '/admin/whatsapp/conversations',
      stat: stats?.totalConversations,
      statLabel: t('admin.whatsapp.totalConversations'),
    },
    {
      icon: MessageCircle,
      title: t('admin.whatsapp.messages'),
      description: t('admin.whatsapp.messagesDesc'),
      path: '/admin/whatsapp/messages',
      stat: stats?.totalMessages,
      statLabel: t('admin.whatsapp.totalMessages'),
    },
    {
      icon: FileText,
      title: t('admin.whatsapp.logs'),
      description: t('admin.whatsapp.logsDesc'),
      path: '/admin/whatsapp/logs',
      stat: stats?.errorsLast7Days,
      statLabel: t('admin.whatsapp.errorsLast7d'),
      statColor: stats?.errorsLast7Days > 0 ? 'error' : 'success',
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>{t('admin.whatsapp.title')}</h1>
          <p>{t('admin.whatsapp.subtitle')}</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={loadStats}
          disabled={loading}
        >
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Quick Stats */}
      {stats && (
        <div className="whatsapp-quick-stats animate-fade-in">
          <div className="whatsapp-stat-item">
            <span className="whatsapp-stat-value">{stats.messagesToday}</span>
            <span className="whatsapp-stat-label">{t('admin.whatsapp.messagesToday')}</span>
          </div>
          <div className="whatsapp-stat-item">
            <span className="whatsapp-stat-value">{stats.inboundMessages}</span>
            <span className="whatsapp-stat-label">{t('admin.whatsapp.inbound')}</span>
          </div>
          <div className="whatsapp-stat-item">
            <span className="whatsapp-stat-value">{stats.outboundMessages}</span>
            <span className="whatsapp-stat-label">{t('admin.whatsapp.outbound')}</span>
          </div>
        </div>
      )}

      <div className="admin-cards-grid">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.path} to={section.path} className="admin-card-link">
              <div className="admin-card whatsapp-card">
                <div className="admin-card-icon whatsapp-icon">
                  <Icon size={28} />
                </div>
                <div className="admin-card-content">
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                  {section.stat !== undefined && (
                    <div className={`whatsapp-card-stat ${section.statColor || ''}`}>
                      <span className="stat-value">{section.stat}</span>
                      <span className="stat-label">{section.statLabel}</span>
                    </div>
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
