import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';
import './PublicLayout.css';
import { NavigationContext } from './PublicNavigationContext';

export default function PublicLayout() {
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();
  const { t } = useTranslation();
  // Keep protected pages unmounted until the signed-out destination commits.
  // A lazy route can otherwise leave their sign-in guards racing navigation.
  useEffect(() => { setSigningOut(false); }, [location.key]);
  useEffect(() => {
    const titleKeys = { '/': 'publicNav.pageTitle', '/login': 'publicNav.teamSignIn', '/signup': 'publicNav.registerShop', '/forgot-password': 'auth.forgotPassword', '/reset-password': 'auth.resetPassword' };
    if (titleKeys[location.pathname]) document.title = `${t(titleKeys[location.pathname])} | Barber++`;
  }, [location.pathname, t]);

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0 });
      return undefined;
    }
    // A destination can be lazy-loaded. Wait for its anchor before scrolling.
    let anchor;
    try { anchor = decodeURIComponent(location.hash.slice(1)); } catch { return undefined; }
    const scrollToAnchor = () => {
      const target = document.getElementById(anchor);
      if (!target) return false;
      target.scrollIntoView({ block: 'start' });
      return true;
    };
    if (scrollToAnchor()) return undefined;
    const observer = new MutationObserver(() => { if (scrollToAnchor()) observer.disconnect(); });
    observer.observe(document.getElementById('public-content'), { childList: true, subtree: true });
    const timer = window.setTimeout(() => observer.disconnect(), 5000);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [location.pathname, location.hash]);

  return <NavigationContext.Provider value={{ busy: busy || signingOut, setBusy, setSigningOut }}>
    <div className="public-site">
      <a className="public-skip" href="#public-content">{t('publicNav.skip')}</a>
      <PublicHeader />
      <div id="public-content" className="public-content" tabIndex={-1}>{signingOut ? <p className="public-sign-out-loading" role="status">{t('customerAuth.signingOut')}</p> : <Outlet />}</div>
      <PublicFooter />
    </div>
  </NavigationContext.Provider>;
}
