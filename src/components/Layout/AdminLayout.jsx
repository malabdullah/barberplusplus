import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import TopBar from './TopBar';
import NotificationToast from '../UI/NotificationToast';
import { useApp } from '../../context/AppContext';
import './Layout.css';

export default function AdminLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toastNotification, hideNotificationToast } = useApp();

  const handleMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMenuClose = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div className="layout admin-layout">
      <AdminSidebar isOpen={mobileMenuOpen} onClose={handleMenuClose} />
      <div className="layout-main">
        <TopBar
          onMenuClick={handleMenuToggle}
          showBranchSelector={false}
          searchPlaceholderKey="admin.searchPlatform"
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
