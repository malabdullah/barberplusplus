import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { customerFeaturesEnabled } from '../../lib/runtimeConfig';
import BrandLogo from '../UI/BrandLogo';
import LanguageSelector from '../UI/LanguageSelector';
import ThemeSelector from '../UI/ThemeSelector';
import NavigationLink from './NavigationLink';
import { usePublicNavigation } from './PublicNavigationContext';

const workspaces = { admin: '/admin', manager: '/dashboard', barber: '/barber', agent: '/agent' };

export default function PublicHeader() {
  const { t } = useTranslation();
  const { isAuthenticated, userRole } = useApp();
  const { customer } = useCustomerAuth();
  const { busy } = usePublicNavigation();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const accountButton = useRef(null);
  const mobileButton = useRef(null);
  const workspace = isAuthenticated && workspaces[userRole];
  const returnTo = location.pathname === '/book' || location.state?.returnTo === '/book' ? '/book' : '/customer/account';

  useEffect(() => { setMobileOpen(false); setAccountOpen(false); }, [location.key]);
  useEffect(() => {
    const close = event => {
      if (event.key === 'Escape') {
        if (accountOpen) { setAccountOpen(false); accountButton.current?.focus(); }
        if (mobileOpen) { setMobileOpen(false); mobileButton.current?.focus(); }
      }
      if (event.type === 'pointerdown' && !accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [mobileOpen, accountOpen]);

  const primaryLinks = <>
    <NavigationLink to="/" aria-current={location.pathname === '/' && !location.hash ? 'page' : undefined}>{t('publicNav.home')}</NavigationLink>
    {customerFeaturesEnabled && <NavigationLink to="/book" aria-current={location.pathname === '/book' ? 'page' : undefined}>{t('publicNav.book')}</NavigationLink>}
    <NavigationLink to="/#for-shops" aria-current={location.pathname === '/' && location.hash === '#for-shops' ? 'location' : undefined}>{t('publicNav.forShops')}</NavigationLink>
  </>;
  const accountLinks = <>
    {customerFeaturesEnabled && (customer ? <>
      <NavigationLink to="/customer/account">{t('publicNav.myAccount')}</NavigationLink>
      <NavigationLink to="/customer/account#appointments">{t('publicNav.myAppointments')}</NavigationLink>
    </> : <NavigationLink to="/customer/sign-in" state={{ returnTo }}>{t('publicNav.customerSignIn')}</NavigationLink>)}
    <NavigationLink to={workspace || '/login'}>{t(workspace ? 'publicNav.workspace' : 'publicNav.teamSignIn')}</NavigationLink>
    {!workspace && <NavigationLink to="/signup">{t('publicNav.registerShop')}</NavigationLink>}
  </>;

  return <header className="public-header">
    <div className="public-header-inner">
      <NavigationLink to="/" className="public-brand" aria-label={t('common.brandHome')}><BrandLogo decorative size="compact" /></NavigationLink>
      <nav className="public-desktop-nav" aria-label={t('publicNav.navigation')}>{primaryLinks}</nav>
      <div className="public-header-actions">
        <LanguageSelector disabled={busy} />
        <ThemeSelector disabled={busy} />
        <div className="public-account" ref={accountRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false); }}>
          <button type="button" className="public-account-button" ref={accountButton} disabled={busy} aria-expanded={accountOpen} aria-controls="public-account-links" onClick={() => setAccountOpen(!accountOpen)}>
            {t(customer ? 'publicNav.myAccount' : workspace ? 'publicNav.workspace' : 'publicNav.signIn')}<ChevronDown size={16} aria-hidden="true" />
          </button>
          {accountOpen && <nav id="public-account-links" className="public-account-links" aria-label={t('publicNav.accounts')}>{accountLinks}</nav>}
        </div>
        <button type="button" ref={mobileButton} className="public-mobile-toggle" aria-expanded={mobileOpen} aria-controls="public-mobile-links" aria-label={t(mobileOpen ? 'publicNav.closeMenu' : 'publicNav.openMenu')} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
    </div>
    {mobileOpen && <nav id="public-mobile-links" className="public-mobile-links" aria-label={t('publicNav.navigation')}>
      {primaryLinks}<div className="public-menu-divider" />{accountLinks}
    </nav>}
    {busy && <span className="sr-only" role="status">{t('publicNav.saving')}</span>}
  </header>;
}
