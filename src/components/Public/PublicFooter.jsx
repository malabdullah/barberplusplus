import React from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BrandLogo from '../UI/BrandLogo';
import { customerFeaturesEnabled } from '../../lib/runtimeConfig';
import NavigationLink from './NavigationLink';

export default function PublicFooter() {
  const { t } = useTranslation();
  const location = useLocation();
  const returnTo = location.pathname === '/book' || location.state?.returnTo === '/book' ? '/book' : '/customer/account';
  return <footer className="public-footer">
    <div className="public-footer-inner">
      <div className="public-footer-brand"><NavigationLink to="/" aria-label={t('common.brandHome')}><BrandLogo decorative size="footer" /></NavigationLink><p>{t('publicNav.footerMessage')}</p></div>
      {customerFeaturesEnabled && <nav aria-label={t('publicNav.forCustomers')}><h2>{t('publicNav.forCustomers')}</h2><NavigationLink to="/book">{t('publicNav.book')}</NavigationLink><NavigationLink to="/customer/account">{t('publicNav.myAccount')}</NavigationLink><NavigationLink to="/customer/sign-in" state={{ returnTo }}>{t('publicNav.customerSignIn')}</NavigationLink></nav>}
      <nav aria-label={t('publicNav.forShops')}><h2>{t('publicNav.forShops')}</h2><NavigationLink to="/#for-shops">{t('landing.nav.features')}</NavigationLink><NavigationLink to="/login">{t('publicNav.teamSignIn')}</NavigationLink><NavigationLink to="/signup">{t('publicNav.registerShop')}</NavigationLink></nav>
      <nav aria-label={t('publicNav.help')}><h2>{t('publicNav.help')}</h2><NavigationLink to="/privacy">{t('landing.footer.privacy')}</NavigationLink><a href="mailto:alabdullah.cs@gmail.com">{t('landing.footer.contact')}</a></nav>
    </div>
    <p className="public-copyright">© {new Date().getFullYear()} {t('landing.footer.copyright')}</p>
  </footer>;
}
