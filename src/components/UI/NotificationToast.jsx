import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import { Bell, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import './NotificationToast.css';
import { useTranslation } from 'react-i18next';
import { ar, enUS } from 'date-fns/locale';
import { notificationCopy } from '../../utils/dashboardNotifications';

// PERFORMANCE: Wrap in React.memo to prevent unnecessary re-renders
const NotificationToast = memo(function NotificationToast({ notification, onClose, duration = 5000 }) {
  const { t, i18n } = useTranslation();
  const [isExiting, setIsExiting] = useState(false);

  // PERFORMANCE: Use ref to avoid effect re-running when onClose changes
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // PERFORMANCE: Memoize handleClose to avoid recreating on every render
  const handleClose = useCallback(() => {
    setIsExiting(true);
    // Wait for exit animation before actually closing
    setTimeout(() => {
      setIsExiting(false);
      onCloseRef.current();
    }, 300);
  }, []);

  useEffect(() => {
    if (!notification) return;

    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [notification, duration, handleClose]);

  if (!notification) return null;

  return (
    <div className={`notification-toast ${isExiting ? 'exiting' : ''}`}>
      <div className="notification-toast-icon">
        <Bell size={18} strokeWidth={1.5} />
      </div>
      <div className="notification-toast-content">
        <div className="notification-toast-header">
          <span className="notification-toast-title">{notificationCopy(notification, t).title}</span>
          <button className="notification-toast-close" aria-label={t('common.close')} onClick={handleClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="notification-toast-message">{notificationCopy(notification, t).message}</p>
        <span className="notification-toast-time">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: i18n.language === 'ar' ? ar : enUS })}
        </span>
      </div>
    </div>
  );
});

export default NotificationToast;
