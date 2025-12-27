import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Bell,
  Search,
  Building2,
  Check,
  Menu,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './TopBar.css';

export default function TopBar({ onMenuClick }) {
  const { branches, selectedBranch, setSelectedBranchId } = useApp();
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setBranchDropdownOpen(false);
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleBranchSelect = (branchId) => {
    setSelectedBranchId(branchId);
    setBranchDropdownOpen(false);
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
            placeholder="Search..."
            className="topbar-search-input"
          />
          <span className="topbar-search-shortcut">⌘K</span>
        </div>
      </div>

      <div className="topbar-right" ref={dropdownRef}>
        {/* Branch Selector */}
        <div className="topbar-branch-selector">
          <button
            className="topbar-branch-btn"
            onClick={() => {
              setBranchDropdownOpen(!branchDropdownOpen);
              setNotificationsOpen(false);
            }}
          >
            <Building2 size={18} strokeWidth={1.5} />
            <span className="topbar-branch-name">
              {selectedBranch?.name || 'Select Branch'}
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
                <span>Switch Branch</span>
              </div>
              <div className="topbar-dropdown-list">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    className={`topbar-dropdown-item ${
                      branch.id === selectedBranch?.id ? 'active' : ''
                    }`}
                    onClick={() => handleBranchSelect(branch.id)}
                  >
                    <div className="topbar-dropdown-item-info">
                      <span className="topbar-dropdown-item-name">{branch.name}</span>
                      <span className="topbar-dropdown-item-address">{branch.address}</span>
                    </div>
                    {branch.id === selectedBranch?.id && (
                      <Check size={16} strokeWidth={2} className="topbar-dropdown-check" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="topbar-notifications">
          <button
            className="topbar-icon-btn"
            onClick={() => {
              setNotificationsOpen(!notificationsOpen);
              setBranchDropdownOpen(false);
            }}
          >
            <Bell size={20} strokeWidth={1.5} />
            <span className="topbar-notification-badge">3</span>
          </button>

          {notificationsOpen && (
            <div className="topbar-dropdown topbar-notifications-dropdown animate-scale-in">
              <div className="topbar-dropdown-header">
                <span>Notifications</span>
                <button className="topbar-dropdown-action">Mark all read</button>
              </div>
              <div className="topbar-dropdown-list">
                <div className="topbar-notification-item unread">
                  <div className="topbar-notification-dot"></div>
                  <div className="topbar-notification-content">
                    <span className="topbar-notification-title">New booking</span>
                    <span className="topbar-notification-text">
                      Robert Wilson booked a Classic Haircut for tomorrow at 10:00 AM
                    </span>
                    <span className="topbar-notification-time">5 min ago</span>
                  </div>
                </div>
                <div className="topbar-notification-item unread">
                  <div className="topbar-notification-dot"></div>
                  <div className="topbar-notification-content">
                    <span className="topbar-notification-title">Booking cancelled</span>
                    <span className="topbar-notification-text">
                      John Anderson cancelled their appointment
                    </span>
                    <span className="topbar-notification-time">1 hour ago</span>
                  </div>
                </div>
                <div className="topbar-notification-item unread">
                  <div className="topbar-notification-dot"></div>
                  <div className="topbar-notification-content">
                    <span className="topbar-notification-title">Barber schedule</span>
                    <span className="topbar-notification-text">
                      James Rodriguez updated their availability for next week
                    </span>
                    <span className="topbar-notification-time">2 hours ago</span>
                  </div>
                </div>
              </div>
              <div className="topbar-dropdown-footer">
                <button>View all notifications</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
