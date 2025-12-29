import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  Clock,
  User,
  Settings,
  LogOut,
  Scissors,
  X,
  FileText,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './Sidebar.css';

const navItems = [
  { path: '/barber', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { path: '/barber/bookings', icon: Calendar, label: 'My Bookings' },
  { path: '/barber/availability', icon: Clock, label: 'My Availability' },
  { path: '/barber/profile', icon: User, label: 'My Profile' },
  { path: '/barber/logs', icon: FileText, label: 'My Activity' },
  { path: '/barber/settings', icon: Settings, label: 'Settings' },
];

export default function BarberSidebar({ isOpen, onClose }) {
  const { logout, currentBarber } = useApp();
  const location = useLocation();

  // Close sidebar when navigating on mobile
  const handleNavClick = () => {
    if (window.innerWidth <= 1024) {
      onClose?.();
    }
  };

  if (!currentBarber) return null;

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
              <span className="sidebar-nav-label">{item.label}</span>
              {isActive && <div className="sidebar-nav-indicator" />}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="sidebar-bottom">
        <div className="sidebar-divider">
          <div className="sidebar-divider-line"></div>
        </div>

        {/* User info */}
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {currentBarber.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{currentBarber.name}</span>
            <span className="sidebar-user-role">Barber</span>
          </div>
        </div>

        {/* Logout */}
        <button className="sidebar-logout" onClick={logout}>
          <LogOut size={18} strokeWidth={1.5} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
    </>
  );
}
