import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { billingWriteIntent, subscriptionRpc } from '../services/subscriptionBilling.service';
import { previewFixedFils } from '../utils/subscriptionPreview';
import './BillingPreview.css';
import '../components/Subscriptions/SubscriptionDesign.css';
import './SubscriptionBilling.css';

function BillingDialog({ title, close, children, busy }) {
  const ref = useRef(null);
  const { t } = useTranslation();
  const titleId = React.useId();
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current.showModal();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog className="billing-dialog subscription-dialog-wide" ref={ref} aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else close(); }}>
    <header className="billing-dialog-heading"><h2 id={titleId}>{title}</h2><button className="billing-icon" type="button" disabled={busy} onClick={close} aria-label={t('billingPreview.close')}><X size={20}/></button></header>
    {children}
  </dialog>;
}

const freshCode = { code: '', kind: 'percent', value: '20', eligibility: 'monthly', payments: '1', expiresOn: '', limit: '', reason: '' };

export default function SubscriptionBilling({ admin = false, codesOnly = false }) {
  const { businessId } = useParams();
  const { user, theme, language } = useApp();
  const { t } = useTranslation();
  const bp = (key, options) => t(`billingPreview.${key}`, options);
  const sp = (key, options) => t(`subscriptionDesign.${key}`, { ...options, postProcess: [] });
  const fb = (key, options) => t(`subscriptionFoundation.${key}`, options);
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [managerId, setManagerId] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [estimateFrequency, setEstimateFrequency] = useState('monthly');
  const [renewal, setRenewal] = useState(true);
  const [codeText, setCodeText] = useState('');
  const [quote, setQuote] = useState(null);
  const [codeHistory, setCodeHistory] = useState([]);
  const [grant, setGrant] = useState({ kind: 'full', startsOn: '', endsOn: '', branchIds: [] });
  const [codeForm, setCodeForm] = useState(freshCode);
  const intent = useRef(null);
  const readSequence = useRef(0);
  const quoteSequence = useRef(0);
  const scope = admin ? businessId : selectedId;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date());
  const date = value => value ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-KW' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuwait' }).format(new Date(value)) : '—';
  const money = fils => `${bp('currency')} ${(Number(fils) / 1000).toFixed(3)}`;
  const readableError = failure => fb(`errors.${failure.message}`, { defaultValue: fb('errors.BILLING_FAILED') });
  const status = value => <span className={`subscription-status status-${value}`}>{fb(`states.${value}`)}</span>;
  const close = () => { if (!busy) { setDialog(null); setError(''); } };
  const open = (type, value = null) => { setError(''); setNotice(''); setReason(''); setTarget(value); setDialog(type); };

  useEffect(() => {
    setRows([]); setDetail(null); setSelectedId(''); setQuote(null); setDialog(null); setPage(0); setQuery(''); setFilter('all'); setError('');
    return () => { readSequence.current++; quoteSequence.current++; };
  }, [user?.id, admin, codesOnly]);

  useEffect(() => {
    const sequence = ++readSequence.current;
    quoteSequence.current++;
    let current = true;
    setDialog(null); setTarget(null); setBusy(false);
    setLoading(true); setError(''); setDetail(null); setQuote(null);
    async function load() {
      if (scope && !codesOnly) {
        const value = await subscriptionRpc('detail', { businessId: scope });
        if (!current || sequence !== readSequence.current) return;
        setDetail(value); setFrequency(value.nextFrequency || value.frequency); setEstimateFrequency(value.frequency); setRenewal(value.renewalRequested);
      } else {
        const value = await subscriptionRpc(codesOnly ? 'codes' : 'businesses', { query, status: filter, offset: page * 20, limit: 20 });
        if (!current || sequence !== readSequence.current) return;
        setRows(value.rows.slice(0, 20)); setHasMore(value.hasMore ?? value.rows.length > 20);
        if (!admin && value.rows.length) setSelectedId(value.rows[0].id);
      }
    }
    load().catch(failure => { if (current) { setRows([]); setError(readableError(failure)); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
    // Translation changes re-render visible strings without repeating a read.
  }, [scope, admin, codesOnly, query, filter, page, refresh, user?.id]);

  async function write(action, data) {
    if (busy) return;
    intent.current = billingWriteIntent(intent.current, action, data);
    setBusy(true); setError(''); setNotice('');
    try {
      await subscriptionRpc(action, { ...data, requestId: intent.current.requestId });
      intent.current = null; setDialog(null); setNotice(fb('saved')); setRefresh(value => value + 1);
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); }
  }

  async function estimate(event) {
    event.preventDefault();
    const sequence = ++quoteSequence.current;
    setBusy(true); setError(''); setQuote(null);
    try {
      const value = await subscriptionRpc('quote', { businessId: detail.id, frequency: estimateFrequency, code: codeText.trim() });
      if (sequence === quoteSequence.current) setQuote(value);
    } catch (failure) { if (sequence === quoteSequence.current) setError(readableError(failure)); }
    finally { if (sequence === quoteSequence.current) setBusy(false); }
  }

  const reasonInput = <label className="subscription-field">{sp('reason')}<textarea maxLength={500} rows={3} required value={reason} onChange={event => setReason(event.target.value)} disabled={busy}/></label>;
  const errorMessage = error && <p role="alert" className="subscription-error">{error}</p>;
  const base = '/admin/subscriptions';
  const enforced = detail?.access?.enforced || rows.some(item => item.access?.enforced);
  const title = codesOnly ? sp('discountCodes') : admin ? detail?.name || sp('subscriptions') : bp('title');
  useEffect(() => { const previous = document.title; document.title = `${title} | Barber++`; return () => { document.title = previous; }; }, [title]);
  async function showCodeHistory(item) {
    open('code-history', item); setCodeHistory([]); setBusy(true);
    try { const value = await subscriptionRpc('code-history', { codeId: item.id }); setCodeHistory(value.rows); }
    catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); }
  }
  const actions = { 'code-history': sp('history'), grant: sp('manageAccess'), 'revoke-grant': sp('removeException'), transfer: sp('transferBilling'), 'create-code': sp('newCode'), 'toggle-code': sp(target?.enabled ? 'pauseCode' : 'enableCode'), preferences: bp('manageSubscription') };

  return <div className="billing-preview billing-foundation" data-theme={theme} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
    <div className="subscription-main">
      {admin && (businessId || codesOnly) && <Link className="subscription-back" to={base}><ArrowLeft size={16}/>{sp('subscriptions')}</Link>}
      <div className="billing-page-heading"><div><h1>{title}</h1>{detail && !admin && <p className="subscription-subtle">{detail.name}</p>}</div><span className="billing-preview-label">{enforced ? t('subscriptionEnforcement.enforced') : fb('foundationLabel')}</span></div>
      <p className="subscription-subtle">{enforced ? t('subscriptionEnforcement.gatewayPostponed') : fb('gatewayPostponed')}</p>
      {notice && <p role="status" className="subscription-notice">{notice}</p>}
      {!dialog && errorMessage}
      {loading ? <p role="status">{t('common.loading')}</p> : detail ? <>
        {!admin && rows.length > 1 && <label className="subscription-field">{fb('chooseBusiness')}<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{rows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <section className="subscription-admin-summary" aria-label={bp('currentSubscription')}>
          <div className="billing-price"><div><strong><bdi>{money(detail.priceFils)}</bdi></strong><span>{bp(detail.frequency === 'monthly' ? 'perMonth' : 'perYear')}</span></div><p>{bp('activeBarbers', { count: detail.count })}</p></div>
          <div>{status(detail.access.status)}<p className="subscription-subtle">{sp('renewalOrExpiry')} · {date(detail.access.until)}</p></div>
          {admin ? <button className="billing-primary" onClick={() => { setGrant({ kind: 'full', startsOn: today, endsOn: '', branchIds: [] }); open('grant'); }}>{sp('manageAccess')}</button> : detail.canManage ? <button className="billing-primary" onClick={() => { setFrequency(detail.nextFrequency || detail.frequency); setRenewal(detail.renewalRequested); open('preferences'); }}>{bp('manageSubscription')}</button> : <span>{fb('managedBy', { name: detail.managerName })}</span>}
        </section>
        <section className="subscription-admin-section"><h2>{sp('businessDetails')}</h2><dl className="billing-review-rows">
          <div><dt>{bp('billingManager')}</dt><dd>{detail.managerName}{admin && <button className="billing-text-button" onClick={() => { setManagerId(''); open('transfer'); }}>{sp('transfer')}</button>}</dd></div>
          <div><dt>{admin ? sp('branches') : t('nav.branches')}</dt><dd>{detail.shops.map(shop => shop.name).join(' · ')}</dd></div>
          <div><dt>{bp('billingFrequency')}</dt><dd>{bp(detail.frequency)}{detail.nextFrequency && <> · {fb('nextFrequency', { frequency: bp(detail.nextFrequency) })}</>}</dd></div>
          <div><dt>{fb('renewalPreference')}</dt><dd>{fb(detail.renewalRequested ? 'renewalRequested' : 'renewalStopped')}</dd></div>
        </dl></section>
        {detail.access.enforced && detail.capacity && <section className="subscription-admin-section"><h2>{t('subscriptionEnforcement.capacity')}</h2><dl className="billing-review-rows">
          <div><dt>{sp('activeCount')}</dt><dd>{detail.count}</dd></div>
          {['active', 'grace'].includes(detail.access.status) && <div><dt>{t('subscriptionEnforcement.paidCapacity')}</dt><dd>{detail.paidCapacity}</dd></div>}
          <div><dt>{t('subscriptionEnforcement.nextBarber')}</dt><dd>{detail.access.status === 'manual' ? t('subscriptionEnforcement.manualCapacity') : detail.capacity.allowed ? t('subscriptionEnforcement.available') : t(`subscriptionEnforcement.errors.${detail.capacity.reason}`)}</dd></div>
          {detail.capacity.additionalFils > 0 && <div><dt>{t('subscriptionEnforcement.additional')}</dt><dd>{money(detail.capacity.additionalFils)}</dd></div>}
        </dl></section>}
        {!admin && <section className="subscription-admin-section"><h2>{sp('calculator')}</h2><form className="subscription-form" onSubmit={estimate}>
          <label className="subscription-field">{bp('billingFrequency')}<select value={estimateFrequency} onChange={event => { setEstimateFrequency(event.target.value); setQuote(null); }}><option value="monthly">{bp('monthly')}</option><option value="yearly">{bp('yearly')}</option></select></label>
          <label className="subscription-field">{sp('discountCode')}<input value={codeText} maxLength={24} onChange={event => { setCodeText(event.target.value); setQuote(null); }} autoCapitalize="characters"/></label>
          <button className="billing-secondary" disabled={busy} type="submit">{fb('calculate')}</button>
        </form>{quote && <dl className="billing-review-rows" aria-live="polite"><div><dt>{sp('activeCount')}</dt><dd>{quote.count}</dd></div><div><dt>{fb('subtotal')}</dt><dd>{money(quote.subtotalFils)}</dd></div><div><dt>{sp('discount')}</dt><dd>{money(quote.discountFils)}</dd></div><div><dt>{sp('estimate')}</dt><dd><strong>{money(quote.totalFils)}</strong></dd></div><div><dt>{sp('standardRenewal')}</dt><dd>{money(quote.normalRenewalFils)}</dd></div>{quote.discountPayments > 0 && <div><dt>{sp('duration')}</dt><dd>{sp(quote.discountPayments === 3 ? 'threeMonthly' : 'firstPayment')}</dd></div>}</dl>}</section>}
        {admin && <section className="subscription-admin-section"><h2>{sp('accessException')}</h2>{detail.grants.length ? <ul className="subscription-foundation-grants">{detail.grants.map(item => <li key={item.id}><div><strong>{sp(item.kind === 'full' ? 'fullAccess' : 'manualAccess')}</strong><span>{date(item.starts_at)} – {date(item.ends_at)}</span></div><p>{item.reason}</p>{item.kind === 'manual' && <p>{detail.shops.filter(shop => item.branch_ids.includes(shop.id)).map(shop => shop.name).join(' · ')}</p>}<button className="billing-text-button subscription-danger" onClick={() => open('revoke-grant', item)}>{sp('removeException')}</button></li>)}</ul> : <p className="subscription-empty">{sp('noException')}</p>}</section>}
        <section className="subscription-admin-section"><h2>{bp('invoices')}</h2>{detail.invoices.length ? <ul>{detail.invoices.map(invoice => <li key={invoice.id}>{date(invoice.created_at)} · {money(invoice.total_fils)} · {invoice.state}</li>)}</ul> : <p className="subscription-empty">{fb('noInvoices')}</p>}</section>
        <section className="subscription-admin-section"><h2>{sp('history')}</h2>{detail.history.length ? <ol className="subscription-history">{detail.history.map(entry => <li key={entry.id}><div><strong>{fb(`actions.${entry.action}`)}</strong><time dateTime={entry.created_at}>{date(entry.created_at)}</time></div><p>{entry.reason}</p></li>)}</ol> : <p className="subscription-empty">{fb('noHistory')}</p>}</section>
      </> : <>
        <div className="subscription-list-tools"><label className="subscription-search"><span className="billing-sr-only">{sp(codesOnly ? 'searchCodes' : 'searchBusinesses')}</span><input type="search" placeholder={sp(codesOnly ? 'searchCodes' : 'searchBusinesses')} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>
          {!codesOnly && admin && <label className="subscription-filter"><span className="billing-sr-only">{sp('accessStatus')}</span><select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">{sp('allStatuses')}</option>{['not_started', 'active', 'trial', 'transition', 'grace', 'expired', 'complimentary', 'manual'].map(value => <option key={value} value={value}>{fb(`states.${value}`)}</option>)}</select></label>}
          {admin && (codesOnly ? <button className="billing-primary" onClick={() => { setCodeForm({ ...freshCode, expiresOn: today }); open('create-code'); }}>{sp('newCode')}</button> : <Link className="billing-secondary" to={`${base}/discounts`}>{sp('discountCodes')}</Link>)}
        </div>
        {rows.length > 0 && <div className="subscription-list" role="region" aria-label={title} tabIndex={0}><table><caption className="billing-sr-only">{title}</caption><thead>{codesOnly ? <tr>{['code','discount','eligibility','duration','redemptions','expires'].map(key => <th scope="col" key={key}>{sp(key)}</th>)}<th scope="col">{bp('status')}</th><th scope="col"><span className="billing-sr-only">{sp('actions')}</span></th></tr> : <tr><th scope="col">{sp('business')}</th><th scope="col">{bp('billingManager')}</th><th scope="col">{sp('barbers')}</th><th scope="col">{sp('price')}</th><th scope="col">{sp('accessStatus')}</th><th scope="col">{sp('renewalOrExpiry')}</th><th scope="col"><span className="billing-sr-only">{sp('actions')}</span></th></tr>}</thead><tbody>{rows.map(item => codesOnly ? <tr key={item.id}><td><strong>{item.code}</strong></td><td>{item.kind === 'percent' ? `${item.value}%` : money(item.value)}</td><td>{sp(`eligibilityOptions.${item.eligibility}`)}</td><td>{sp(item.payments === 3 ? 'threeMonthly' : 'firstPayment')}</td><td>{item.used} / {item.redemption_limit ?? sp('unlimited')}</td><td>{date(new Date(new Date(item.expires_at).getTime()-1).toISOString())}</td><td>{status(item.enabled ? 'enabled' : 'paused')}</td><td><button className="billing-text-button" onClick={() => open('toggle-code',item)}>{sp(item.enabled ? 'pause' : 'enable')}</button><button className="billing-text-button" onClick={() => showCodeHistory(item)}>{sp('history')}</button></td></tr> : <tr key={item.id}><td><Link className="subscription-business-link" to={`${base}/${item.id}`}>{item.name}</Link></td><td>{item.managerName || '—'}</td><td>{item.count}</td><td><bdi>{money(item.priceFils)}</bdi><small>{bp(item.frequency)}</small></td><td>{status(item.access.status)}</td><td>{date(item.access.until)}</td><td><Link className="billing-icon" to={`${base}/${item.id}`} aria-label={sp('viewBusiness',{name:item.name})}><ArrowRight size={18}/></Link></td></tr>)}</tbody></table></div>}
        {!rows.length ? <p className="subscription-empty">{sp('noResults')}</p> : <ul className="subscription-foundation-list subscription-foundation-mobile">{rows.map(item => <li key={item.id}>{codesOnly ? <><div><strong>{item.code}</strong>{status(item.enabled ? 'enabled' : 'paused')}</div><dl><div><dt>{sp('discount')}</dt><dd>{item.kind === 'percent' ? `${item.value}%` : money(item.value)}</dd></div><div><dt>{sp('eligibility')}</dt><dd>{sp(`eligibilityOptions.${item.eligibility}`)}</dd></div><div><dt>{sp('duration')}</dt><dd>{sp(item.payments === 3 ? 'threeMonthly' : 'firstPayment')}</dd></div><div><dt>{sp('expires')}</dt><dd>{date(new Date(new Date(item.expires_at).getTime() - 1).toISOString())}</dd></div><div><dt>{sp('redemptions')}</dt><dd>{item.used} / {item.redemption_limit ?? sp('unlimited')}</dd></div></dl><button className="billing-text-button" onClick={() => open('toggle-code', item)}>{sp(item.enabled ? 'pause' : 'enable')}</button><button className="billing-text-button" onClick={() => showCodeHistory(item)}>{sp('history')}</button></> : <><div><Link className="subscription-business-link" to={admin ? `${base}/${item.id}` : '/dashboard/billing'} onClick={() => { if (!admin) setSelectedId(item.id); }}>{item.name}</Link>{status(item.access.status)}</div><dl><div><dt>{bp('billingManager')}</dt><dd>{item.managerName}</dd></div><div><dt>{sp('barbers')}</dt><dd>{item.count}</dd></div><div><dt>{sp('price')}</dt><dd>{money(item.priceFils)} / {bp(item.frequency)}</dd></div><div><dt>{sp('renewalOrExpiry')}</dt><dd>{date(item.access.until)}</dd></div></dl><Link className="billing-text-button" to={`${base}/${item.id}`}>{sp('manageAccess')}<ArrowRight size={16}/></Link></>}</li>)}</ul>}
        <div className="subscription-pagination"><button className="billing-icon" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)} aria-label={sp('previousPage')}><ChevronLeft size={20}/></button><span>{fb('page', { page: page + 1 })}</span><button className="billing-icon" disabled={!hasMore || loading} onClick={() => setPage(value => value + 1)} aria-label={sp('nextPage')}><ChevronRight size={20}/></button></div>
      </>}

      {dialog && <BillingDialog title={actions[dialog]} close={close} busy={busy}>{dialog === 'code-history' ? <>{busy ? <p role="status">{t('common.loading')}</p> : codeHistory.length ? <ol className="subscription-history">{codeHistory.map(entry => <li key={entry.id}><div><strong>{fb(`actions.${entry.action}`)}</strong><time dateTime={entry.created_at}>{date(entry.created_at)}</time></div><p>{entry.reason}</p></li>)}</ol> : <p>{fb('noHistory')}</p>}{errorMessage}</> : <form className="subscription-form" onSubmit={event => {
        event.preventDefault();
        if (dialog === 'preferences') write(dialog, { businessId: detail.id, frequency, renewalRequested: renewal, revision: detail.revision });
        if (dialog === 'grant') write(dialog, { businessId: detail.id, ...grant, reason });
        if (dialog === 'revoke-grant') write(dialog, { businessId: detail.id, grantId: target.id, reason });
        if (dialog === 'transfer') write(dialog, { businessId: detail.id, managerId, reason });
        if (dialog === 'toggle-code') write(dialog, { codeId: target.id, enabled: !target.enabled, reason });
        if (dialog === 'create-code') {
          const value = codeForm.kind === 'fixed' ? previewFixedFils(codeForm.value) : Number(codeForm.value);
          if (!Number.isSafeInteger(value) || value < 1 || (codeForm.kind === 'percent' && value > 100)) { setError(sp('invalidDiscount')); return; }
          write(dialog, { ...codeForm, value, payments: Number(codeForm.payments), limit: codeForm.limit || null, reason });
        }
      }}>
        {dialog === 'preferences' && <><label className="subscription-field">{bp('billingFrequency')}<select value={frequency} onChange={event => setFrequency(event.target.value)} disabled={busy}><option value="monthly">{bp('monthly')}</option><option value="yearly">{bp('yearly')}</option></select></label><label className="subscription-check"><input type="checkbox" checked={renewal} onChange={event => setRenewal(event.target.checked)} disabled={busy}/>{fb('requestRenewal')}</label><p className="subscription-subtle">{fb('nextTermOnly')}</p></>}
        {dialog === 'grant' && <><label className="subscription-field">{sp('accessType')}<select value={grant.kind} onChange={event => setGrant(current => ({ ...current, kind: event.target.value }))}><option value="full">{sp('fullAccess')}</option><option value="manual">{sp('manualAccess')}</option></select></label><div className="subscription-form-pair"><label className="subscription-field">{sp('startsOn')}<input type="date" required min={today} value={grant.startsOn} onInput={event => setGrant(current => ({ ...current, startsOn: event.target.value }))}/></label><label className="subscription-field">{fb('endsBefore')}<input type="date" required min={grant.startsOn} value={grant.endsOn} onInput={event => setGrant(current => ({ ...current, endsOn: event.target.value }))}/></label></div>{grant.kind === 'manual' && <fieldset><legend>{sp('branches')}</legend>{detail.shops.map(shop => <label className="subscription-check" key={shop.id}><input type="checkbox" checked={grant.branchIds.includes(shop.id)} onChange={event => setGrant(current => ({ ...current, branchIds: event.target.checked ? [...current.branchIds, shop.id] : current.branchIds.filter(id => id !== shop.id) }))}/>{shop.name}</label>)}</fieldset>}</>}
        {dialog === 'transfer' && <><label className="subscription-field">{bp('billingManager')}<select value={managerId} required onChange={event => setManagerId(event.target.value)}><option value="">{sp('chooseManager')}</option>{detail.managers.filter(person => person.id !== detail.managerId).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{detail.managers.filter(person => person.id !== detail.managerId).length === 0 && <p>{sp('noAlternativeManager')}</p>}</>}
        {dialog === 'create-code' && <><label className="subscription-field">{sp('code')}<input required maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,23}" value={codeForm.code} onChange={event => setCodeForm(current => ({ ...current, code: event.target.value.toUpperCase() }))}/></label><div className="subscription-form-pair"><label className="subscription-field">{sp('discountType')}<select value={codeForm.kind} onChange={event => setCodeForm(current => ({ ...current, kind: event.target.value }))}><option value="percent">{sp('percentage')}</option><option value="fixed">{sp('fixedAmount')}</option></select></label><label className="subscription-field">{sp('discountValue')}<input required inputMode="decimal" value={codeForm.value} onChange={event => setCodeForm(current => ({ ...current, value: event.target.value }))}/></label></div><label className="subscription-field">{sp('eligibility')}<select value={codeForm.eligibility} onChange={event => setCodeForm(current => ({ ...current, eligibility: event.target.value, payments: '1' }))}>{['monthly', 'yearly', 'both'].map(value => <option key={value} value={value}>{sp(`eligibilityOptions.${value}`)}</option>)}</select></label><label className="subscription-field">{sp('duration')}<select value={codeForm.payments} onChange={event => setCodeForm(current => ({ ...current, payments: event.target.value }))}><option value="1">{sp('firstPayment')}</option>{codeForm.eligibility === 'monthly' && <option value="3">{sp('threeMonthly')}</option>}</select></label><div className="subscription-form-pair"><label className="subscription-field">{sp('expires')}<input type="date" required min={today} value={codeForm.expiresOn} onInput={event => setCodeForm(current => ({ ...current, expiresOn: event.target.value }))}/></label><label className="subscription-field">{sp('redemptionLimit')}<input type="number" min="1" step="1" value={codeForm.limit} onChange={event => setCodeForm(current => ({ ...current, limit: event.target.value }))}/></label></div></>}
        {dialog !== 'preferences' && reasonInput}
        {errorMessage}
        <div className="billing-dialog-actions"><button className="billing-secondary" type="button" disabled={busy} onClick={close}>{t('common.cancel')}</button><button className="billing-primary" type="submit" disabled={busy || (dialog === 'transfer' && !managerId)}>{busy ? t('common.saving') : t('common.save')}</button></div>
      </form>}</BillingDialog>}
    </div>
  </div>;
}
