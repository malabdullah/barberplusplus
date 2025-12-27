import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BarberSidebar from './BarberSidebar';
import BarberTopBar from './BarberTopBar';
import './Layout.css';

export default function BarberLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
        <BarberTopBar onMenuClick={handleMenuToggle} />
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
