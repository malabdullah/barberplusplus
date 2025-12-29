import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  Search,
  Menu,
  CheckCheck,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApp } from '../../context/AppContext';
import './TopBar.css';

export default function BarberTopBar({ onMenuClick }) {
  const {
    barberBranch,
    notifications,
    unreadCount,
    notificationsLoading,
    markNotificationRead,
    markAllNotificationsRead,
  } = useApp();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = async (notification) => {
    if (!notification.isRead) {
      await markNotificationRead(notification.id);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="topbar-menu-btn" onClick={onMenuClick}>
          <Menu size={20} strokeWidth={1.5} />
        </button>

        {/* Search */}
        <div className="topbar-search">
          <Search size={18} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search bookings..."
            className="topbar-search-input"
          />
          <span className="topbar-search-shortcut">⌘K</span>
        </div>
      </div>

      <div className="topbar-right" ref={dropdownRef}>
        {/* Branch Info (read-only) */}
        {barberBranch && (
          <div className="topbar-branch-info">
            <span className="topbar-branch-label">{barberBranch.name}</span>
          </div>
        )}

        {/* Notifications */}
        <div className="topbar-notifications">
          <button
            className="topbar-icon-btn"
            onClick={() => setNotificationsOpen(!notificationsOpen)}
          >
            <Bell size={20} strokeWidth={1.5} />
            {unreadCount > 0 && (
              <span className="topbar-notification-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="topbar-dropdown topbar-notifications-dropdown animate-scale-in">
              <div className="topbar-dropdown-header">
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <button className="topbar-dropdown-action" onClick={handleMarkAllRead}>
                    <CheckCheck size={14} />
                    Mark all read
                  </button>
                )}
              </div>
              <div className="topbar-dropdown-list">
                {notificationsLoading ? (
                  <div className="topbar-notification-empty">
                    <Loader2 size={20} className="animate-spin" />
                    <span>Loading...</span>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="topbar-notification-empty">
                    <Bell size={24} strokeWidth={1} />
                    <span>No notifications yet</span>
                  </div>
                ) : (
                  notifications.slice(0, 10).map((notification) => (
                    <button
                      key={notification.id}
                      className={`topbar-notification-item ${!notification.isRead ? 'unread' : ''}`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      {!notification.isRead && <div className="topbar-notification-dot" />}
                      <div className="topbar-notification-content">
                        <span className="topbar-notification-title">
                          {notification.title}
                        </span>
                        <span className="topbar-notification-text">
                          {notification.message}
                        </span>
                        <span className="topbar-notification-time">
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {notifications.length > 10 && (
                <div className="topbar-dropdown-footer">
                  <button>View all notifications</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
