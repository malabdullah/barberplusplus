import React, { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import './NotificationToast.css';

export default function NotificationToast({ notification, onClose, duration = 5000 }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (!notification) return;

    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [notification, duration]);

  const handleClose = () => {
    setIsExiting(true);
    // Wait for exit animation before actually closing
    setTimeout(() => {
      setIsExiting(false);
      onClose();
    }, 300);
  };

  if (!notification) return null;

  return (
    <div className={`notification-toast ${isExiting ? 'exiting' : ''}`}>
      <div className="notification-toast-icon">
        <Bell size={18} strokeWidth={1.5} />
      </div>
      <div className="notification-toast-content">
        <div className="notification-toast-header">
          <span className="notification-toast-title">{notification.title}</span>
          <button className="notification-toast-close" onClick={handleClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="notification-toast-message">{notification.message}</p>
        <span className="notification-toast-time">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
