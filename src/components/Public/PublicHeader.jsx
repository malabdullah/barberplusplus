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
  const [openDropdown, setOpenDropdown] = useState(null);
  const dropdownRefs = useRef({});
  const dropdownButtons = useRef({});
  const mobileButton = useRef(null);
  const workspace = isAuthenticated && workspaces[userRole];
  const returnTo = location.pathname === '/book' || location.state?.returnTo === '/book' ? '/book' : '/customer/account';

  useEffect(() => { setMobileOpen(false); setOpenDropdown(null); }, [location.key]);
  useEffect(() => {
    const close = event => {
      if (event.key === 'Escape') {
        if (openDropdown) { setOpenDropdown(null); dropdownButtons.current[openDropdown]?.focus(); }
        if (mobileOpen) { setMobileOpen(false); mobileButton.current?.focus(); }
      }
      if (event.type === 'pointerdown' && openDropdown && !dropdownRefs.current[openDropdown]?.contains(event.target)) setOpenDropdown(null);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [mobileOpen, openDropdown]);
  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 1050px)');
    const closeMenus = () => { setMobileOpen(false); setOpenDropdown(null); };
    breakpoint.addEventListener('change', closeMenus);
    return () => breakpoint.removeEventListener('change', closeMenus);
  }, []);

  const customerLinks = customer ? <>
    <NavigationLink to="/customer/account">{t('publicNav.myAccount')}</NavigationLink>
    <NavigationLink to="/customer/account#appointments">{t('publicNav.myAppointments')}</NavigationLink>
  </> : <NavigationLink to="/customer/sign-in" state={{ returnTo }} aria-current={location.pathname === '/customer/sign-in' ? 'page' : undefined}>{t('publicNav.customerSignIn')}</NavigationLink>;
  const shopLinks = <>
    <NavigationLink to={workspace || '/login'}>{t(workspace ? 'publicNav.workspace' : 'publicNav.teamSignIn')}</NavigationLink>
    {!workspace && <NavigationLink to="/signup">{t('publicNav.registerShop')}</NavigationLink>}
  </>;
  const bookLink = <NavigationLink to="/book" className="public-book-link" aria-current={location.pathname === '/book' ? 'page' : undefined}>{t('publicNav.book')}</NavigationLink>;
  const dropdown = (id, label, content) => <div className="public-nav-disclosure" ref={element => { dropdownRefs.current[id] = element; }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpenDropdown(current => current === id ? null : current);
  }}>
    <button type="button" className="public-disclosure-button" ref={element => { dropdownButtons.current[id] = element; }} disabled={busy} aria-expanded={openDropdown === id} aria-controls={`public-${id}-links`} onClick={() => setOpenDropdown(current => current === id ? null : id)}>
      {label}<ChevronDown size={16} aria-hidden="true" />
    </button>
    {openDropdown === id && <div id={`public-${id}-links`} className="public-dropdown-links" role="group" aria-label={label}>{content}</div>}
  </div>;

  return <header className="public-header">
    <div className="public-header-inner">
      <NavigationLink to="/" className="public-brand" aria-label={t('common.brandHome')}><BrandLogo decorative size="compact" symbolOnSmallScreens /></NavigationLink>
      <nav className="public-desktop-nav" aria-label={t('publicNav.navigation')}>
        {customerFeaturesEnabled && <>{bookLink}{customer ? dropdown('account', t('publicNav.myAccount'), customerLinks) : customerLinks}</>}
        {dropdown('shops', t('publicNav.shops'), shopLinks)}
      </nav>
      <div className="public-header-actions">
        <LanguageSelector disabled={busy} />
        <ThemeSelector disabled={busy} />
        <button type="button" ref={mobileButton} className="public-mobile-toggle" aria-expanded={mobileOpen} aria-controls="public-mobile-links" aria-label={t(mobileOpen ? 'publicNav.closeMenu' : 'publicNav.openMenu')} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
    </div>
    {mobileOpen && <nav id="public-mobile-links" className="public-mobile-links" aria-label={t('publicNav.navigation')}>
      {customerFeaturesEnabled && <div className="public-mobile-group" role="group" aria-labelledby="public-customers-label">
        <h2 id="public-customers-label">{t('publicNav.customers')}</h2>{bookLink}{customerLinks}
      </div>}
      <div className="public-mobile-group" role="group" aria-labelledby="public-shops-label">
        <h2 id="public-shops-label">{t('publicNav.shops')}</h2>{shopLinks}
      </div>
    </nav>}
    {busy && <span className="sr-only" role="status">{t('publicNav.saving')}</span>}
  </header>;
}
