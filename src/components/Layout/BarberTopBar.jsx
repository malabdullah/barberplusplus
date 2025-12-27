import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  Search,
  Menu,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './TopBar.css';

export default function BarberTopBar({ onMenuClick }) {
  const { barberBranch, barberBookings } = useApp();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Get today's bookings for notifications
  const today = new Date().toISOString().split('T')[0];
  const todayBookings = barberBookings.filter(b => b.date === today && ['confirmed', 'pending'].includes(b.status));

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
            {todayBookings.length > 0 && (
              <span className="topbar-notification-badge">{todayBookings.length}</span>
            )}
          </button>

          {notificationsOpen && (
            <div className="topbar-dropdown topbar-notifications-dropdown animate-scale-in">
              <div className="topbar-dropdown-header">
                <span>Today's Bookings</span>
              </div>
              <div className="topbar-dropdown-list">
                {todayBookings.length > 0 ? (
                  todayBookings.slice(0, 5).map((booking) => (
                    <div key={booking.id} className="topbar-notification-item">
                      <div className="topbar-notification-dot"></div>
                      <div className="topbar-notification-content">
                        <span className="topbar-notification-title">{booking.time}</span>
                        <span className="topbar-notification-text">
                          {booking.customerName} - {booking.serviceName}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="topbar-notification-item">
                    <div className="topbar-notification-content">
                      <span className="topbar-notification-text">No bookings for today</span>
                    </div>
                  </div>
                )}
              </div>
              {todayBookings.length > 5 && (
                <div className="topbar-dropdown-footer">
                  <button>View all bookings</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
