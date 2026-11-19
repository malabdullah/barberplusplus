import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Bell, Building2, Calculator, Calendar, CreditCard, Globe, Home, LayoutDashboard, Menu, Moon, Scissors, Settings, ShieldCheck, Sun, Tag, UserRound, Users, Wallet, X } from 'lucide-react';
import BrandLogo from '../UI/BrandLogo';
import useSidebarAccessibility from '../../hooks/useSidebarAccessibility';
import { useSubscriptionPreview } from '../../context/SubscriptionPreviewContext';
import '../../pages/BillingPreview.css';
import './SubscriptionDesign.css';

const navigation = [
  ['nav.dashboard','/dashboard',LayoutDashboard], ['nav.branches','/dashboard/branches',Building2],
  ['nav.services','/dashboard/services',Scissors], ['nav.barbers','/dashboard/barbers',Users],
  ['nav.bookings','/dashboard/bookings',Calendar], ['reports.title','/dashboard/reports',BarChart3],
  ['finance.title','/dashboard/finances',Wallet], ['nav.settings','/dashboard/settings',Settings],
];

export function PreviewDialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const { bp } = useSubscriptionPreview();
  const titleId = React.useId();
  useEffect(() => {
    const element = ref.current;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, [title]);
  return <dialog ref={ref} className={`billing-dialog${wide ? ' subscription-dialog-wide' : ''}`} aria-labelledby={titleId} onCancel={onClose}>
    <header className="billing-dialog-heading"><h2 id={titleId}>{title}</h2><button className="billing-icon" type="button" onClick={onClose} aria-label={bp('close')}><X size={20} aria-hidden="true" /></button></header>
    {children}
  </dialog>;
}

export default function PreviewShell({ children, active = 'billing', admin = false }) {
  const {language,setLanguage,theme,setTheme,t,bp,sp} = useSubscriptionPreview();
  const [menuOpen,setMenuOpen] = useState(false);
  const sidebarRef = useSidebarAccessibility(menuOpen,()=>setMenuOpen(false),t('common.navigation'));
  const previewLinks = [
    ['billing','/design/billing',t('subscriptionFoundation.menuTitle'),CreditCard],
    ['calculator','/design/calculator',sp('calculator'),Calculator],
    ['subscriptions','/design/subscriptions',sp('subscriptions'),ShieldCheck],
    ['codes','/design/discounts',sp('discountCodes'),Tag],
  ];
  return <div className="billing-preview" data-theme={theme} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
    {menuOpen && <button className="billing-menu-backdrop" type="button" aria-label={bp('close')} onClick={()=>setMenuOpen(false)} />}
    <aside ref={sidebarRef} className={`billing-sidebar${menuOpen ? ' is-open' : ''}`}>
      <button className="billing-icon billing-menu-close" type="button" onClick={()=>setMenuOpen(false)} aria-label={bp('close')}><X size={20} /></button>
      <Link className="billing-brand" to="/" aria-label={t('common.brandHome')}><BrandLogo tone={theme} decorative tagline={admin ? sp('adminPreview') : t('common.manager')} /></Link>
      <div className="billing-sidebar-divider" />
      <div className="billing-profile"><span className="billing-avatar" aria-hidden="true">{admin ? 'A' : 'N'}</span><div><strong>{admin ? sp('adminPreview') : bp('managerName')}</strong><small>{admin ? t('common.admin') : t('common.manager')}</small></div></div>
      <nav>{!admin && navigation.map(([key,path,Icon])=><Link key={path} to={path} className="billing-nav-link" onClick={()=>setMenuOpen(false)}><Icon size={20} strokeWidth={1.5} aria-hidden="true" /><span>{t(key)}</span></Link>)}
        {previewLinks.filter(([key])=>admin ? key==='subscriptions'||key==='codes' : key==='billing'||key==='calculator').map(([key,path,label,Icon])=><Link key={key} to={path} className={`billing-nav-link${active===key ? ' is-active' : ''}`} aria-current={active===key ? 'page' : undefined} onClick={()=>setMenuOpen(false)}><Icon size={20} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span></Link>)}
      </nav>
      <div className="subscription-preview-switch"><span>{sp('previewScreens')}</span><Link to={admin ? '/design/billing' : '/design/subscriptions'}>{admin ? sp('managerPreview') : sp('adminPreview')}</Link></div>
    </aside>
    <div className="billing-workspace" inert={menuOpen ? '' : undefined}>
      <header className="billing-topbar"><div className="billing-topbar-start">
        <button className="billing-topbar-icon billing-menu-toggle" type="button" onClick={()=>setMenuOpen(true)} aria-label={t('common.navigation')} aria-expanded={menuOpen}><Menu size={20} /></button>
        <Link className="billing-topbar-icon billing-home" to="/" aria-label={t('publicNav.home')}><Home size={20} strokeWidth={1.5} /></Link>
        <Link className="billing-customer-mode" to={admin ? '/admin' : '/book'}><UserRound size={19} strokeWidth={1.5} />{admin ? sp('workspace') : bp('customerMode')}</Link>
      </div><div className="billing-topbar-end">
        <span className="billing-shop"><Building2 size={18} aria-hidden="true" /><span>{admin ? <bdi dir="ltr">Barber++</bdi> : bp('shopName')}</span></span>
        <button className="billing-topbar-icon" type="button" onClick={()=>setLanguage(language==='en'?'ar':'en')} aria-label={bp('switchLanguage')}><Globe size={21} strokeWidth={1.5} /></button>
        <button className="billing-topbar-icon" type="button" onClick={()=>setTheme(theme==='light'?'dark':'light')} aria-label={bp(theme==='light'?'darkMode':'lightMode')}>{theme==='light'?<Moon size={21} strokeWidth={1.5}/>:<Sun size={21} strokeWidth={1.5}/>}</button>
        <Link className="billing-topbar-icon billing-notifications" to={admin ? '/admin/notifications' : '/dashboard/notifications'} aria-label={bp('notifications')}><Bell size={20} strokeWidth={1.5}/></Link>
      </div></header>
      {children}
    </div>
  </div>;
}

export function PreviewHeading({ title, children }) {
  const {bp} = useSubscriptionPreview();
  return <div className="billing-page-heading"><div><h1>{title}</h1>{children}</div><span className="billing-preview-label">{bp('previewLabel')}</span></div>;
}
