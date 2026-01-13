import React from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Calendar,
  Users,
  MessageCircle,
  Settings,
  Scissors,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SignOutCard from '../UI/SignOutCard';
import './Sidebar.css';

const navItems = [
  { path: '/agent', icon: LayoutDashboard, labelKey: 'nav.dashboard', exact: true },
  { path: '/agent/bookings', icon: Calendar, labelKey: 'nav.bookings' },
  { path: '/agent/customers', icon: Users, labelKey: 'agent.nav.customers' },
  { path: '/agent/conversations', icon: MessageCircle, labelKey: 'agent.nav.conversations' },
  { path: '/agent/settings', icon: Settings, labelKey: 'nav.settings' },
];

export default function AgentSidebar({ isOpen, onClose }) {
  const { t } = useTranslation();
  const { user } = useApp();
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

      <aside className={`sidebar agent-sidebar ${isOpen ? 'open' : ''}`}>
        {/* Mobile close button */}
        <button className="sidebar-close-btn" onClick={onClose}>
          <X size={20} strokeWidth={2} />
        </button>

        {/* Logo */}
        <Link to="/" className="sidebar-logo" aria-label="Barber++ Home">
          <div className="sidebar-logo-icon agent-logo-icon">
            <Scissors size={24} strokeWidth={1.5} />
          </div>
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">Barber++</span>
            <span className="sidebar-logo-tagline agent-tagline">{t('common.agent')}</span>
          </div>
        </Link>

        {/* Decorative line */}
        <div className="sidebar-divider">
          <div className="sidebar-divider-line"></div>
          <div className="sidebar-divider-diamond agent-diamond"></div>
          <div className="sidebar-divider-line"></div>
        </div>

        {/* User info */}
        <div className="sidebar-user">
          <div className="sidebar-user-avatar agent-avatar">
            {(user?.user_metadata?.name || 'Agent').split(' ').map(n => n[0]).join('')}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.user_metadata?.name || 'Agent'}</span>
            <span className="sidebar-user-role agent-role">{t('common.agent')}</span>
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
