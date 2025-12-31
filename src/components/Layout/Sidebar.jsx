import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Building2,
  Scissors,
  Users,
  Calendar,
  Settings,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SignOutCard from '../UI/SignOutCard';
import './Sidebar.css';

const navItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', exact: true },
  { path: '/branches', icon: Building2, labelKey: 'nav.branches' },
  { path: '/services', icon: Scissors, labelKey: 'nav.services' },
  { path: '/barbers', icon: Users, labelKey: 'nav.barbers' },
  { path: '/bookings', icon: Calendar, labelKey: 'nav.bookings' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

export default function Sidebar({ isOpen, onClose }) {
  const { t } = useTranslation();
  const { manager } = useApp();
  const location = useLocation();

  // Close sidebar when navigating on mobile
  const handleNavClick = () => {
    if (window.innerWidth <= 1024) {
      onClose?.();
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="sidebar-overlay" onClick={onClose} />
      )}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Mobile close button */}
        <button className="sidebar-close-btn" onClick={onClose}>
          <X size={20} strokeWidth={2} />
        </button>

        {/* Logo */}
        <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Scissors size={24} strokeWidth={1.5} />
        </div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">Barber++</span>
          <span className="sidebar-logo-tagline">Manager</span>
        </div>
      </div>

      {/* Decorative line */}
      <div className="sidebar-divider">
        <div className="sidebar-divider-line"></div>
        <div className="sidebar-divider-diamond"></div>
        <div className="sidebar-divider-line"></div>
      </div>

      {/* User info */}
      <div className="sidebar-user">
        <div className="sidebar-user-avatar">
          {(manager?.user_metadata?.name || t('common.name')).split(' ').map(n => n[0]).join('')}
        </div>
        <div className="sidebar-user-info">
          <span className="sidebar-user-name">{manager?.user_metadata?.name || t('common.name')}</span>
          <span className="sidebar-user-role">{t('common.manager')}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={handleNavClick}
              className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="sidebar-nav-icon">
                <Icon size={20} strokeWidth={1.5} />
              </div>
              <span className="sidebar-nav-label">{t(item.labelKey)}</span>
              {isActive && <div className="sidebar-nav-indicator" />}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="sidebar-bottom">
        {/* Logout */}
        <SignOutCard />
      </div>
    </aside>
    </>
  );
}
