import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BarberSidebar from './BarberSidebar';
import TopBar from './TopBar';
import NotificationToast from '../UI/NotificationToast';
import { useApp } from '../../context/AppContext';
import './Layout.css';

export default function BarberLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toastNotification, hideNotificationToast } = useApp();

  const handleMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMenuClose = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div className="layout">
      <BarberSidebar isOpen={mobileMenuOpen} onClose={handleMenuClose} />
      <div className="layout-main">
        <TopBar
          onMenuClick={handleMenuToggle}
          showBranchSelector={false}
          searchPlaceholderKey="bookings.searchBookings"
        />
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
      <NotificationToast
        notification={toastNotification}
        onClose={hideNotificationToast}
      />
    </div>
  );
}
