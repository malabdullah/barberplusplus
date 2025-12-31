import React, { useState, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  CheckCheck,
  Filter,
  Loader2,
  Check,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useApp } from '../context/AppContext';
import { notificationPreferencesService } from '../services';
import './Notifications.css';

const NotificationItem = memo(function NotificationItem({ notification, onMarkRead }) {
  const { i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;

  return (
    <div
      className={`notification-item ${!notification.isRead ? 'unread' : ''}`}
      onClick={() => !notification.isRead && onMarkRead(notification.id)}
    >
      {!notification.isRead && <div className="notification-unread-dot" />}
      <div className="notification-content">
        <span className="notification-title">{notification.title}</span>
        <span className="notification-message">{notification.message}</span>
        <span className="notification-time">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: dateLocale })}
        </span>
      </div>
      {!notification.isRead && (
        <button
          className="notification-mark-read-btn"
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(notification.id);
          }}
          title="Mark as read"
        >
          <Check size={16} />
        </button>
      )}
    </div>
  );
});

export default function Notifications() {
  const { t } = useTranslation();
  const {
    notifications,
    notificationsLoading,
    notificationPreferences,
    markNotificationRead,
    markAllNotificationsRead,
  } = useApp();

  const [filter, setFilter] = useState('all'); // 'all' | 'unread' | 'read'

  // Filter notifications based on user preferences
  const visibleNotifications = useMemo(() => {
    if (!notificationPreferences) return notifications;
    return notifications.filter(n =>
      notificationPreferencesService.isTypeEnabled(notificationPreferences, n.type, n.createdAt)
    );
  }, [notifications, notificationPreferences]);

  // Apply read/unread filter
  const filteredNotifications = useMemo(() => {
    switch (filter) {
      case 'unread':
        return visibleNotifications.filter(n => !n.isRead);
      case 'read':
        return visibleNotifications.filter(n => n.isRead);
      default:
        return visibleNotifications;
    }
  }, [visibleNotifications, filter]);

  // Count unread
  const unreadCount = useMemo(() => {
    return visibleNotifications.filter(n => !n.isRead).length;
  }, [visibleNotifications]);

  const handleMarkRead = async (id) => {
    await markNotificationRead(id);
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
  };

  return (
    <div className="notifications-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">{t('notifications.allNotifications')}</h2>
          <p className="page-description">
            {t('notifications.pageDescription')}
          </p>
        </div>
        {unreadCount > 0 && (
          <button className="btn btn-secondary" onClick={handleMarkAllRead}>
            <CheckCheck size={18} strokeWidth={2} />
            {t('notifications.markAllRead')}
          </button>
        )}
      </div>

      {/* Filter Controls */}
      <div className="notifications-controls animate-fade-in-up stagger-1">
        <div className="notifications-filter">
          <Filter size={18} strokeWidth={1.5} />
          <select
            className="notifications-filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">{t('notifications.filterAll')}</option>
            <option value="unread">{t('notifications.filterUnread')} ({unreadCount})</option>
            <option value="read">{t('notifications.filterRead')}</option>
          </select>
        </div>
        <div className="notifications-count">
          {filteredNotifications.length} {t('notifications.notificationsCount')}
        </div>
      </div>

      {/* Notifications List */}
      <div className="notifications-list animate-fade-in-up stagger-2">
        {notificationsLoading ? (
          <div className="notifications-empty">
            <Loader2 size={32} className="animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="notifications-empty">
            <Bell size={48} strokeWidth={1} />
            <span className="notifications-empty-title">
              {filter === 'unread'
                ? t('notifications.noUnreadNotifications')
                : t('notifications.noNotifications')}
            </span>
            <span className="notifications-empty-text">
              {t('notifications.emptyDescription')}
            </span>
          </div>
        ) : (
          filteredNotifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={handleMarkRead}
            />
          ))
        )}
      </div>
    </div>
  );
}
