import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Calendar,
  Clock,
  User,
  Settings,
  Scissors,
  X,
  FileText,
  Loader2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SignOutCard from '../UI/SignOutCard';
import './Sidebar.css';

const navItems = [
  { path: '/barber', icon: LayoutDashboard, labelKey: 'nav.dashboard', exact: true },
  { path: '/barber/bookings', icon: Calendar, labelKey: 'nav.myBookings' },
  { path: '/barber/availability', icon: Clock, labelKey: 'nav.availability' },
  { path: '/barber/profile', icon: User, labelKey: 'nav.profile' },
  { path: '/barber/logs', icon: FileText, labelKey: 'nav.myActivity' },
  { path: '/barber/settings', icon: Settings, labelKey: 'nav.settings' },
];

export default function BarberSidebar({ isOpen, onClose }) {
  const { t } = useTranslation();
  const { currentBarber, barberProfileLoading, barberProfileError } = useApp();
  const location = useLocation();

  // Close sidebar when navigating on mobile
  const handleNavClick = () => {
    if (window.innerWidth <= 1024) {
      onClose?.();
    }
  };

  // Show loading state while barber profile loads OR hasn't been checked yet
  if (barberProfileLoading || (!currentBarber && !barberProfileError)) {
    return (
      <>
        {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
          <button className="sidebar-close-btn" onClick={onClose}>
            <X size={20} strokeWidth={2} />
          </button>
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <Scissors size={24} strokeWidth={1.5} />
            </div>
            <div className="sidebar-logo-text">
              <span className="sidebar-logo-name">Barber++</span>
              <span className="sidebar-logo-tagline">Barber</span>
            </div>
          </div>
          <div className="sidebar-divider">
            <div className="sidebar-divider-line"></div>
            <div className="sidebar-divider-diamond"></div>
            <div className="sidebar-divider-line"></div>
          </div>
          <div className="sidebar-loading">
            <Loader2 size={24} strokeWidth={1.5} className="sidebar-loading-spinner" />
            <span>{t('common.loading')}</span>
          </div>
        </aside>
      </>
    );
  }

  // Show minimal sidebar with sign out only if profile check actually failed
  if (barberProfileError) {
    return (
      <>
        {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
          <button className="sidebar-close-btn" onClick={onClose}>
            <X size={20} strokeWidth={2} />
          </button>
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <Scissors size={24} strokeWidth={1.5} />
            </div>
            <div className="sidebar-logo-text">
              <span className="sidebar-logo-name">Barber++</span>
              <span className="sidebar-logo-tagline">Barber</span>
            </div>
          </div>
          <div className="sidebar-divider">
            <div className="sidebar-divider-line"></div>
            <div className="sidebar-divider-diamond"></div>
            <div className="sidebar-divider-line"></div>
          </div>
          <div className="sidebar-bottom" style={{ marginTop: 'auto' }}>
            <SignOutCard />
          </div>
        </aside>
      </>
    );
  }

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
          <span className="sidebar-logo-tagline">Barber</span>
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
          {currentBarber.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div className="sidebar-user-info">
          <span className="sidebar-user-name">{currentBarber.name}</span>
          <span className="sidebar-user-role">{t('common.barber')}</span>
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
