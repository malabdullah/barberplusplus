import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Bell,
  Search,
  Building2,
  Check,
  Menu,
  CheckCheck,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useApp } from '../../context/AppContext';
import { notificationPreferencesService } from '../../services';
import LanguageSelector from '../UI/LanguageSelector';
import ThemeSelector from '../UI/ThemeSelector';
import './TopBar.css';

/**
 * Unified TopBar component for both manager and barber roles
 * @param {Object} props
 * @param {Function} props.onMenuClick - Handler for mobile menu toggle
 * @param {boolean} props.showBranchSelector - Whether to show branch selector (manager) or just display branch name (barber)
 * @param {string} props.searchPlaceholderKey - Translation key for search placeholder
 */
export default function TopBar({
  onMenuClick,
  showBranchSelector = true,
  searchPlaceholderKey = 'common.search',
}) {
  const { t, i18n } = useTranslation();
  const {
    branches,
    selectedBranch,
    barberBranch,
    setSelectedBranchId,
    notifications,
    notificationsLoading,
    notificationPreferences,
    markNotificationRead,
    markAllNotificationsRead,
    userRole,
  } = useApp();
  const navigate = useNavigate();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activePreferenceDropdown, setActivePreferenceDropdown] = useState(null);
  const dropdownRef = useRef(null);

  // Get the current branch based on role
  const currentBranch = showBranchSelector ? selectedBranch : barberBranch;

  // Filter notifications based on user preferences
  const visibleNotifications = useMemo(() => {
    if (!notificationPreferences) return notifications;
    return notifications.filter(n =>
      notificationPreferencesService.isTypeEnabled(notificationPreferences, n.type, n.createdAt)
    );
  }, [notifications, notificationPreferences]);

  // Calculate visible unread count
  const visibleUnreadCount = useMemo(() => {
    return visibleNotifications.filter(n => !n.isRead).length;
  }, [visibleNotifications]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setBranchDropdownOpen(false);
        setNotificationsOpen(false);
        setActivePreferenceDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle preference dropdown toggle (close others when one opens)
  const handlePreferenceDropdownToggle = (dropdownName) => {
    setActivePreferenceDropdown(dropdownName);
    if (dropdownName) {
      setBranchDropdownOpen(false);
      setNotificationsOpen(false);
    }
  };

  const handleBranchSelect = (branchId) => {
    setSelectedBranchId(branchId);
    setBranchDropdownOpen(false);
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.isRead) {
      await markNotificationRead(notification.id);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
  };

  const handleViewAllNotifications = () => {
    setNotificationsOpen(false);
    navigate(userRole === 'barber' ? '/barber/notifications' : '/notifications');
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
            placeholder={t(searchPlaceholderKey)}
            className="topbar-search-input"
          />
          <span className="topbar-search-shortcut">⌘K</span>
        </div>
      </div>

      <div className="topbar-right" ref={dropdownRef}>
        {/* Branch Selector (Manager) or Branch Info (Barber) */}
        {showBranchSelector ? (
          <div className="topbar-branch-selector">
            <button
              className="topbar-branch-btn"
              onClick={() => {
                setBranchDropdownOpen(!branchDropdownOpen);
                setNotificationsOpen(false);
                setActivePreferenceDropdown(null);
              }}
            >
              <Building2 size={18} strokeWidth={1.5} />
              <span className="topbar-branch-name">
                {currentBranch?.name || t('branches.selectBranch')}
              </span>
              <ChevronDown
                size={16}
                strokeWidth={1.5}
                className={`topbar-branch-chevron ${branchDropdownOpen ? 'open' : ''}`}
              />
            </button>

            {branchDropdownOpen && (
              <div className="topbar-dropdown topbar-branch-dropdown animate-scale-in">
                <div className="topbar-dropdown-header">
                  <span>{t('branches.switchBranch')}</span>
                </div>
                <div className="topbar-dropdown-list">
                  {branches.map((branch) => (
                    <button
                      key={branch.id}
                      className={`topbar-dropdown-item ${
                        branch.id === currentBranch?.id ? 'active' : ''
                      }`}
                      onClick={() => handleBranchSelect(branch.id)}
                    >
                      <div className="topbar-dropdown-item-info">
                        <span className="topbar-dropdown-item-name">{branch.name}</span>
                        <span className="topbar-dropdown-item-address">{branch.address}</span>
                      </div>
                      {branch.id === currentBranch?.id && (
                        <Check size={16} strokeWidth={2} className="topbar-dropdown-check" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : currentBranch && (
          <div className="topbar-branch-info">
            <span className="topbar-branch-label">{currentBranch.name}</span>
          </div>
        )}

        {/* Language Selector */}
        <LanguageSelector onDropdownToggle={handlePreferenceDropdownToggle} />

        {/* Theme Selector */}
        <ThemeSelector onDropdownToggle={handlePreferenceDropdownToggle} />

        {/* Notifications */}
        <div className="topbar-notifications">
          <button
            className="topbar-icon-btn"
            onClick={() => {
              setNotificationsOpen(!notificationsOpen);
              setBranchDropdownOpen(false);
              setActivePreferenceDropdown(null);
            }}
          >
            <Bell size={20} strokeWidth={1.5} />
            {visibleUnreadCount > 0 && (
              <span className="topbar-notification-badge">
                {visibleUnreadCount > 99 ? '99+' : visibleUnreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="topbar-dropdown topbar-notifications-dropdown animate-scale-in">
              <div className="topbar-dropdown-header">
                <span>{t('notifications.title')}</span>
                {visibleUnreadCount > 0 && (
                  <button className="topbar-dropdown-action" onClick={handleMarkAllRead}>
                    <CheckCheck size={14} />
                    {t('notifications.markAllRead')}
                  </button>
                )}
              </div>
              <div className="topbar-dropdown-list">
                {notificationsLoading ? (
                  <div className="topbar-notification-empty">
                    <Loader2 size={20} className="animate-spin" />
                    <span>{t('common.loading')}</span>
                  </div>
                ) : visibleNotifications.length === 0 ? (
                  <div className="topbar-notification-empty">
                    <Bell size={24} strokeWidth={1} />
                    <span>{t('notifications.noNotifications')}</span>
                  </div>
                ) : (
                  visibleNotifications.slice(0, 10).map((notification) => (
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
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: dateLocale })}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {visibleNotifications.length > 10 && (
                <div className="topbar-dropdown-footer">
                  <button onClick={handleViewAllNotifications}>{t('notifications.viewAll')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
