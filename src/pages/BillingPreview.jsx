import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, BarChart3, Bell, Building2, Calendar, Check, ChevronDown,
  CreditCard, Download, Globe, Home, LayoutDashboard, Menu, Moon,
  RotateCcw, Scissors, Settings, Sun, UserRound, Users, Wallet, X,
} from 'lucide-react';
import BrandLogo from '../components/UI/BrandLogo';
import useSidebarAccessibility from '../hooks/useSidebarAccessibility';
import './BillingPreview.css';

// Design-only fixtures. This page has no billing API, storage writes or real invoices.
const barbers = [
  { name: 'Omar', initials: 'OM', type: 'invited' },
  { name: 'Youssef', initials: 'YO', type: 'managed' },
  { name: 'Kareem', initials: 'KA', type: 'managed' },
  { name: 'Ali', initials: 'AL', type: 'invited' },
  { name: 'Hassan', initials: 'HA', type: 'managed' },
  { name: 'Nasser', initials: 'NA', type: 'chair' },
];
const invoices = ['2026-11-01', '2026-10-01', '2026-09-01'];
const renewalDate = '2026-12-01';
const navigation = [
  ['nav.dashboard', '/dashboard', LayoutDashboard],
  ['nav.branches', '/dashboard/branches', Building2],
  ['nav.services', '/dashboard/services', Scissors],
  ['nav.barbers', '/dashboard/barbers', Users],
  ['nav.bookings', '/dashboard/bookings', Calendar],
  ['reports.title', '/dashboard/reports', BarChart3],
  ['finance.title', '/dashboard/finances', Wallet],
  ['nav.settings', '/dashboard/settings', Settings],
];

function PreviewDialog({ title, onClose, children }) {
  const ref = useRef(null);
  const titleId = React.useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, [title]);
  return <dialog className="billing-dialog" ref={ref} aria-labelledby={titleId} onCancel={onClose}>
    <header className="billing-dialog-heading">
      <h2 id={titleId}>{title}</h2>
      <button className="billing-icon" type="button" onClick={onClose} aria-label={children.closeLabel}><X size={20} aria-hidden="true" /></button>
    </header>
    {children.content}
  </dialog>;
}

export default function BillingPreview() {
  const { i18n } = useTranslation();
  const [language, setLanguage] = useState(i18n.resolvedLanguage?.startsWith('ar') ? 'ar' : 'en');
  const [theme, setTheme] = useState('light');
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [frequency, setFrequency] = useState('monthly');
  const [scheduled, setScheduled] = useState(null);
  const [renewalEnabled, setRenewalEnabled] = useState(true);
  const [notice, setNotice] = useState('');
  const [invoice, setInvoice] = useState(null);
  const t = useMemo(() => i18n.getFixedT(language), [i18n, language]);
  const tr = (key, options) => t(`billingPreview.${key}`, options);
  const sidebarRef = useSidebarAccessibility(menuOpen, () => setMenuOpen(false), t('common.navigation'));
  const date = (value, monthOnly = false) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-KW' : 'en-GB', {
    ...(monthOnly ? {} : { day: 'numeric' }), month: 'short', year: 'numeric', timeZone: 'Asia/Kuwait',
  }).format(new Date(`${value}T12:00:00+03:00`));
  const money = amount => `${tr('currency')} ${Number(amount).toFixed(3)}`;
  const close = () => setDialog(null);
  const reset = () => {
    setScheduled(null); setRenewalEnabled(true); setExpanded(false);
    setFrequency('monthly'); setNotice(''); setDialog(null); setInvoice(null);
  };
  const openManage = () => {
    setFrequency(scheduled || 'monthly');
    setDialog('manage');
    setNotice('');
  };
  const confirmChange = () => {
    setScheduled(frequency === 'monthly' ? null : 'yearly');
    setNotice(tr(frequency === 'yearly' ? 'scheduledNotice' : 'monthlyNotice', { date: date(renewalDate) }));
    close();
  };

  return <div className="billing-preview" data-theme={theme} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
    {menuOpen && <button className="billing-menu-backdrop" type="button" aria-label={tr('close')} onClick={() => setMenuOpen(false)} />}
    <aside ref={sidebarRef} className={`billing-sidebar${menuOpen ? ' is-open' : ''}`} aria-label={t('common.navigation')}>
      <button className="billing-icon billing-menu-close" type="button" onClick={() => setMenuOpen(false)} aria-label={tr('close')}><X size={20} /></button>
      <Link className="billing-brand" to="/" aria-label={t('common.brandHome')}><BrandLogo tone={theme} decorative tagline={t('common.manager')} /></Link>
      <div className="billing-sidebar-divider" />
      <div className="billing-profile"><span className="billing-avatar" aria-hidden="true">N</span><div><strong>{tr('managerName')}</strong><small>{t('common.manager')}</small></div></div>
      <nav>
        {navigation.map(([key, path, Icon]) => <Link key={path} to={path} className="billing-nav-link" onClick={() => setMenuOpen(false)}><Icon size={20} strokeWidth={1.5} aria-hidden="true" /><span>{t(key)}</span></Link>)}
        <a href="#billing-main" className="billing-nav-link is-active" aria-current="page" onClick={() => setMenuOpen(false)}><CreditCard size={20} strokeWidth={1.5} aria-hidden="true" />{tr('title')}</a>
      </nav>
    </aside>

    <div className="billing-workspace" inert={menuOpen ? '' : undefined}>
      <header className="billing-topbar">
        <div className="billing-topbar-start">
          <button className="billing-topbar-icon billing-menu-toggle" type="button" onClick={() => setMenuOpen(true)} aria-label={t('common.navigation')} aria-expanded={menuOpen}><Menu size={20} /></button>
          <Link className="billing-topbar-icon billing-home" to="/" aria-label={t('publicNav.home')}><Home size={20} strokeWidth={1.5} /></Link>
          <Link className="billing-customer-mode" to="/book"><UserRound size={19} strokeWidth={1.5} />{tr('customerMode')}</Link>
        </div>
        <div className="billing-topbar-end">
          <span className="billing-shop"><Building2 size={18} aria-hidden="true" /><span>{tr('shopName')}</span></span>
          <button className="billing-topbar-icon" type="button" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} aria-label={tr('switchLanguage')}><Globe size={21} strokeWidth={1.5} /></button>
          <button className="billing-topbar-icon" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={tr(theme === 'light' ? 'darkMode' : 'lightMode')}>{theme === 'light' ? <Moon size={21} strokeWidth={1.5} /> : <Sun size={21} strokeWidth={1.5} />}</button>
          <Link className="billing-topbar-icon billing-notifications" to="/dashboard/notifications" aria-label={tr('notifications')}><Bell size={20} strokeWidth={1.5} /></Link>
        </div>
      </header>

      <main className="billing-main" id="billing-main">
        <div className="billing-page-heading"><div><h1>{tr('title')}</h1><span className="billing-active"><Check size={14} aria-hidden="true" />{tr('active')}</span></div><button type="button" className="billing-preview-label" onClick={() => setDialog('preview')}>{tr('previewLabel')}</button></div>
        <section className="billing-summary" aria-label={tr('currentSubscription')}>
          <div className="billing-price"><div><strong dir="ltr">{money(60)}</strong><span>{tr('perMonth')}</span></div><p>{tr('activeBarbers', { count: 6 })}</p></div>
          <div className="billing-renewal"><span>{tr(renewalEnabled ? 'nextRenewal' : 'accessUntil')}</span><strong>{date(renewalDate)}</strong></div>
          <button className="billing-primary" type="button" onClick={openManage}>{tr('manage')}</button>
        </section>

        {(scheduled || !renewalEnabled) && <div className="billing-scheduled"><span>{tr(!renewalEnabled ? 'renewalCancelled' : 'scheduledSummary', { date: date(renewalDate), amount: money(600) })}</span><button className="billing-text-button" type="button" onClick={() => { setScheduled(null); setRenewalEnabled(true); setNotice(tr('restored')); }}>{tr('undo')}</button></div>}
        <p className="billing-live-notice billing-sr-only" role="status">{notice}</p>

        <section className="billing-details" aria-label={tr('subscriptionDetails')}>
          <button type="button" className="billing-detail-row billing-usage-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="billing-usage">
            <strong>{tr('usage')}</strong><span>{tr('usageSummary', { count: 6 })}</span><ChevronDown size={20} aria-hidden="true" className={expanded ? 'is-expanded' : ''} />
          </button>
          {expanded && <div id="billing-usage" className="billing-usage"><table><caption className="billing-sr-only">{tr('usage')}</caption><thead><tr><th scope="col">{tr('barber')}</th><th scope="col">{tr('type')}</th><th scope="col">{tr('status')}</th></tr></thead><tbody>{barbers.map(barber => <tr key={barber.name}><td><span className="billing-initials" aria-hidden="true">{barber.initials}</span>{tr(`names.${barber.name}`)}</td><td>{tr(barber.type)}</td><td><span className="billing-paid">{tr('active')}</span></td></tr>)}</tbody></table></div>}
          <div className="billing-detail-row"><strong>{tr('billingManager')}</strong><span>{tr('managerName')}</span></div>
        </section>

        <section className="billing-invoices" aria-labelledby="billing-invoices-title">
          <h2 id="billing-invoices-title">{tr('invoices')}</h2>
          <table><caption className="billing-sr-only">{tr('sampleInvoices')}</caption><thead><tr><th scope="col">{tr('date')}</th><th scope="col" className="billing-period">{tr('period')}</th><th scope="col">{tr('amount')}</th><th scope="col">{tr('status')}</th><th scope="col"><span className="billing-sr-only">{tr('invoice')}</span></th></tr></thead><tbody>
            {invoices.map(value => <tr key={value}><td>{date(value)}</td><td className="billing-period">{date(value, true)}</td><td><bdi>{money(60)}</bdi></td><td><span className="billing-paid">{tr('paid')}</span></td><td><button className="billing-icon" type="button" onClick={() => { setInvoice(value); setDialog('invoice'); }} aria-label={tr('openInvoice', { date: date(value) })}><Download size={21} strokeWidth={1.5} aria-hidden="true" /></button></td></tr>)}
          </tbody></table>
        </section>
      </main>
    </div>

    {dialog && <PreviewDialog title={tr(dialog === 'manage' ? 'manage' : dialog === 'review' ? 'reviewChange' : dialog === 'cancel' ? 'cancelTitle' : dialog === 'invoice' ? 'sampleInvoice' : 'previewLabel')} onClose={close}>{
      { closeLabel: tr('close'), content: <>
        {dialog === 'preview' && <><p>{tr('previewDescription')}</p><button type="button" className="billing-secondary" onClick={reset}><RotateCcw size={17} />{tr('reset')}</button></>}
        {dialog === 'manage' && <>
          <p className="billing-dialog-caption">{tr('previewLabel')}</p>
          <fieldset className="billing-frequency"><legend>{tr('billingFrequency')}</legend>{['monthly', 'yearly'].map(value => <label key={value} className={frequency === value ? 'is-selected' : ''}><input type="radio" name="billing-frequency" value={value} checked={frequency === value} onChange={() => setFrequency(value)} /><span>{tr(value)}</span></label>)}</fieldset>
          <div className="billing-quote"><strong><bdi>{money(frequency === 'monthly' ? 60 : 600)}</bdi></strong><span>{tr(frequency === 'monthly' ? 'perMonth' : 'perYear')}</span></div>
          {frequency === 'yearly' && <p className="billing-savings">{tr('yearlySavings', { amount: money(120) })}</p>}
          <dl className="billing-review-rows"><div><dt>{tr('activeBarbers', { count: 6 })}</dt><dd>{tr('includedFeatures')}</dd></div><div><dt>{tr('starts')}</dt><dd>{date(renewalDate)}</dd></div></dl>
          {!renewalEnabled && <p className="billing-cancel-copy">{tr('renewalCancelled', { date: date(renewalDate) })}</p>}
          <button type="button" className="billing-primary billing-dialog-primary" disabled={!renewalEnabled || frequency === (scheduled || 'monthly')} onClick={() => setDialog('review')}>{tr('reviewChange')}</button>
          <button type="button" className={renewalEnabled ? 'billing-danger' : 'billing-text-button'} onClick={() => {
            if (renewalEnabled) setDialog('cancel');
            else { setRenewalEnabled(true); setNotice(tr('restored')); close(); }
          }}>{tr(renewalEnabled ? 'cancelRenewal' : 'resumeRenewal')}</button>
        </>}
        {dialog === 'review' && <>
          <p>{tr('changeDescription', { date: date(renewalDate) })}</p>
          <dl className="billing-review-rows"><div><dt>{tr('billingFrequency')}</dt><dd>{tr(frequency)}</dd></div><div><dt>{tr('nextPayment')}</dt><dd><bdi>{money(frequency === 'yearly' ? 600 : 60)}</bdi></dd></div><div><dt>{tr('starts')}</dt><dd>{date(renewalDate)}</dd></div></dl>
          <p className="billing-dialog-caption">{tr('noPayment')}</p>
          <div className="billing-dialog-actions"><button className="billing-secondary" type="button" onClick={() => setDialog('manage')}><ArrowLeft size={16} />{tr('back')}</button><button className="billing-primary" type="button" onClick={confirmChange}>{tr('confirmPreview')}</button></div>
        </>}
        {dialog === 'cancel' && <>
          <p>{tr('cancelDescription', { shop: tr('shopName'), date: date(renewalDate) })}</p>
          <p className="billing-dialog-caption">{tr('noPayment')}</p>
          <div className="billing-dialog-actions"><button className="billing-secondary" type="button" onClick={() => setDialog('manage')}>{tr('keepRenewal')}</button><button className="billing-danger-button" type="button" onClick={() => { setRenewalEnabled(false); setScheduled(null); setNotice(tr('renewalCancelled', { date: date(renewalDate) })); close(); }}>{tr('confirmPreview')}</button></div>
        </>}
        {dialog === 'invoice' && <>
          <div className="billing-invoice-preview"><BrandLogo tone={theme} size="compact" /><p>{tr('sampleInvoice')}</p><h3>{tr('shopName')}</h3><dl className="billing-review-rows"><div><dt>{tr('date')}</dt><dd>{date(invoice)}</dd></div><div><dt>{tr('period')}</dt><dd>{date(invoice, true)}</dd></div><div><dt>{tr('activeBarbers', { count: 6 })}</dt><dd><bdi>{money(60)}</bdi></dd></div><div><dt>{tr('status')}</dt><dd>{tr('paid')}</dd></div></dl></div>
          <p className="billing-dialog-caption">{tr('invoiceDescription')}</p>
          <button className="billing-secondary" type="button" onClick={() => {
            const text = `Barber++ — SAMPLE INVOICE — NO PAYMENT\nAtlas Grooming\n${invoice}\n6 active barbers\nKWD 60.000\nDesign preview only. Not an accounting document.\n`;
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            const a = document.createElement('a'); a.href = url; a.download = `sample-invoice-${invoice}.txt`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}><Download size={17} />{tr('downloadSample')}</button>
        </>}
      </> }
    }</PreviewDialog>}
  </div>;
}
