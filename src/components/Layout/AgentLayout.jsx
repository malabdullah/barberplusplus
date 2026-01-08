import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AgentSidebar from './AgentSidebar';
import TopBar from './TopBar';
import NotificationToast from '../UI/NotificationToast';
import { useApp } from '../../context/AppContext';
import './Layout.css';

export default function AgentLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toastNotification, hideNotificationToast } = useApp();

  const handleMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMenuClose = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div className="layout agent-layout">
      <AgentSidebar isOpen={mobileMenuOpen} onClose={handleMenuClose} />
      <div className="layout-main">
        <TopBar
          onMenuClick={handleMenuToggle}
          showBranchSelector={true}
          searchPlaceholderKey="agent.customers.searchPlaceholder"
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
