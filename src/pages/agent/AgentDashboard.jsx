import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Users,
  MessageCircle,
  ArrowRight,
  Plus,
  Phone,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { agentService } from '../../services/agent.service';
import './AgentPages.css';

export default function AgentDashboard() {
  const { t } = useTranslation();
  const { user } = useApp();
  const [metrics, setMetrics] = useState({
    bookingsCreatedToday: 0,
    activeConversations: 0,
    customersHelped: 0,
  });
  const [recentConversations, setRecentConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [metricsData, convData] = await Promise.all([
          agentService.getAgentMetrics(user?.id),
          agentService.getRecentConversations(5),
        ]);
        setMetrics(metricsData);
        setRecentConversations(convData);
      } catch (error) {
        console.error('Error loading agent dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [user?.id]);

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard.greeting.morning');
    if (hour < 18) return t('dashboard.greeting.afternoon');
    return t('dashboard.greeting.evening');
  };

  const quickActions = [
    {
      icon: Plus,
      label: t('dashboard.newBooking'),
      path: '/agent/bookings',
      color: 'blue',
    },
    {
      icon: Users,
      label: t('agent.nav.customers'),
      path: '/agent/customers',
      color: 'green',
    },
    {
      icon: MessageCircle,
      label: t('agent.nav.conversations'),
      path: '/agent/conversations',
      color: 'amber',
    },
  ];

  return (
    <div className="agent-dashboard">
      {/* Header */}
      <div className="agent-dashboard-header">
        <div className="agent-dashboard-greeting">
          <h1>{getGreeting()}, {user?.user_metadata?.name || 'Agent'}</h1>
          <p>{t('agent.dashboard.subtitle')}</p>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="agent-metrics-grid">
        <div className="agent-metric-card">
          <div className="agent-metric-icon blue">
            <Calendar size={24} />
          </div>
          <div className="agent-metric-content">
            <span className="agent-metric-value">
              {loading ? '...' : metrics.bookingsCreatedToday}
            </span>
            <span className="agent-metric-label">{t('agent.dashboard.bookingsCreatedToday')}</span>
          </div>
        </div>

        <div className="agent-metric-card">
          <div className="agent-metric-icon green">
            <MessageCircle size={24} />
          </div>
          <div className="agent-metric-content">
            <span className="agent-metric-value">
              {loading ? '...' : metrics.activeConversations}
            </span>
            <span className="agent-metric-label">{t('agent.dashboard.activeConversations')}</span>
          </div>
        </div>

        <div className="agent-metric-card">
          <div className="agent-metric-icon amber">
            <Users size={24} />
          </div>
          <div className="agent-metric-content">
            <span className="agent-metric-value">
              {loading ? '...' : metrics.customersHelped}
            </span>
            <span className="agent-metric-label">{t('agent.dashboard.customersHelped')}</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="agent-section">
        <h2 className="agent-section-title">{t('dashboard.quickActions')}</h2>
        <div className="agent-quick-actions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.path}
                to={action.path}
                className={`agent-quick-action ${action.color}`}
              >
                <div className="agent-quick-action-icon">
                  <Icon size={24} />
                </div>
                <span className="agent-quick-action-label">{action.label}</span>
                <ArrowRight size={16} className="agent-quick-action-arrow" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="agent-section">
        <div className="agent-section-header">
          <h2 className="agent-section-title">{t('agent.dashboard.recentConversations')}</h2>
          <Link to="/agent/conversations" className="agent-section-link">
            {t('common.viewAll')} <ArrowRight size={14} />
          </Link>
        </div>
        {recentConversations.length > 0 ? (
          <div className="agent-conversations-list">
            {recentConversations.map((conv) => (
              <div key={conv.id} className="agent-conversation-item">
                <div className="agent-conversation-avatar">
                  <Phone size={16} />
                </div>
                <div className="agent-conversation-info">
                  <span className="agent-conversation-phone">{conv.phoneNumber}</span>
                  <span className="agent-conversation-name">
                    {conv.customerName || t('admin.whatsapp.unknownCustomer')}
                  </span>
                </div>
                <Link to="/agent/bookings" className="btn btn-sm btn-secondary">
                  {t('dashboard.newBooking')}
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="agent-empty-state">
            <MessageCircle size={48} />
            <p>{t('agent.dashboard.noRecentConversations')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
