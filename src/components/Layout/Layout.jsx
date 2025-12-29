import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import NotificationToast from '../UI/NotificationToast';
import { useApp } from '../../context/AppContext';
import './Layout.css';

export default function Layout() {
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
      <Sidebar isOpen={mobileMenuOpen} onClose={handleMenuClose} />
      <div className="layout-main">
        <TopBar onMenuClick={handleMenuToggle} />
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
